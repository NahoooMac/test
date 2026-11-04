import type { LightMyRequestResponse } from 'fastify';
import { loadConfig } from '../src/config/env.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { buildApp } from '../src/app.ts';
import { ManualClock } from '../src/shared/clock.ts';
import { FakeSmsProvider } from '../src/integrations/sms/fake.ts';
import { FakeGeoProvider } from '../src/integrations/maps/fake.ts';

export const ORIGIN = 'http://localhost:5173';

/** Fresh in-memory Postgres (PGlite) with all migrations applied. Never touches Neon. */
export async function createTestDatabase(): Promise<Database> {
  const database = createDatabase({ pgliteDir: 'memory://' });
  await runMigrations(database);
  return database;
}

export async function createTestApp(
  opts: { env?: Record<string, string>; database?: Database; clock?: ManualClock } = {},
) {
  const database = opts.database ?? (await createTestDatabase());
  const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: ORIGIN, ...opts.env });
  const clock = opts.clock ?? new ManualClock();
  const sms = new FakeSmsProvider();
  const { app, dispatcher, kyc } = await buildApp({
    config,
    database,
    clock,
    sms,
    geo: new FakeGeoProvider(),
  });

  // `ip` sets the client address (proxy headers are not trusted outside production).
  const post = (
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
    ip = '127.0.0.1',
  ) =>
    app.inject({
      method: 'POST',
      url,
      remoteAddress: ip,
      headers: { origin: ORIGIN, ...headers },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  return {
    app,
    dispatcher,
    kyc,
    database,
    clock,
    sms,
    config,
    post,
    get: (url: string, headers: Record<string, string> = {}) =>
      app.inject({ method: 'GET', url, headers }),
    async close(keepDatabase = false) {
      await app.close();
      if (!keepDatabase) await database.close();
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/** "sid=abc…" from a Set-Cookie response, for sending back as a Cookie header. */
export function sessionCookie(res: LightMyRequestResponse): string {
  const c = res.cookies.find((x) => x.name === 'sid');
  if (!c) throw new Error('No session cookie set');
  return `sid=${c.value}`;
}

/**
 * A minimal, well-formed JPEG header (APP0 + SOF0 with the given size) padded to `bytes`: enough for
 * the server's checks, which read the frame size without decoding the picture.
 */
export function fakeJpeg(width = 1280, height = 960, bytes = 12_000): string {
  const b = Buffer.alloc(bytes, 0x11);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 0); // SOI + APP0 (16 bytes)
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255], 20);
  b.set([0xff, 0xd9], bytes - 2); // EOI
  return b.toString('base64');
}

/** Metrics a real, cooperative rider produces for each liveness action. */
export function goodLivenessMetrics(action: string) {
  const yawDeg = action === 'right' ? 30 : action === 'left' ? -30 : 0;
  return {
    yawDeg,
    pitchDeg: 2,
    holdMs: 900,
    faceCount: 1,
    faceArea: 0.12,
    faceShift: 0.05,
    jitterDeg: 0.6,
    maxStepDeg: 4,
    blinks: 1,
  };
}

/** Completes a live face check with valid steps and frames; returns the final session state. */
export async function passLiveness(t: TestApp, cookie: string) {
  const start = await t.app.inject({
    method: 'POST',
    url: '/api/rider/kyc/liveness',
    headers: { cookie, origin: ORIGIN },
  });
  if (start.statusCode !== 200) throw new Error(`liveness start failed: ${start.body}`);
  const session = start.json() as { id: string; sequence: string[] };
  let last: unknown = null;
  for (const [index, action] of session.sequence.entries()) {
    t.clock.advanceSeconds(2);
    const now = t.clock.now().getTime();
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/rider/kyc/liveness/${session.id}/steps`,
      headers: { cookie, origin: ORIGIN },
      payload: {
        index,
        action,
        startedAt: new Date(now - 1500).toISOString(),
        completedAt: new Date(now).toISOString(),
        metrics: goodLivenessMetrics(action),
        ...(action === 'center' ? {} : { image: fakeJpeg() }),
        client: { userAgent: 'test', model: 'face_landmarker' },
      },
    });
    if (res.statusCode !== 200) throw new Error(`liveness ${action} failed: ${res.body}`);
    last = res.json();
  }
  return { session, last: last as { status: string } };
}

/** Uploads every required KYC photo (faces via the live check) and submits the application. */
export async function submitKyc(t: TestApp, cookie: string) {
  const kyc = (await t.app.inject({ method: 'GET', url: '/api/rider/kyc', headers: { cookie } })).json();
  await passLiveness(t, cookie);
  for (const kind of (kyc.required as string[]).filter((k) => !k.startsWith('face_'))) {
    const res = await t.app.inject({
      method: 'PUT',
      url: `/api/rider/kyc/documents/${kind}`,
      headers: { cookie, origin: ORIGIN },
      payload: { image: fakeJpeg() },
    });
    if (res.statusCode !== 200) throw new Error(`upload ${kind} failed: ${res.body}`);
  }
  const res = await t.post('/api/rider/kyc/submit', undefined, { cookie });
  if (res.statusCode !== 200) throw new Error(`submit failed: ${res.body}`);
  return res.json();
}

/** Full happy-path sign-in; returns the cookie header and the user. */
export async function signIn(t: TestApp, phone = '0911234567', ip = '10.0.0.1') {
  const req = await t.post('/api/auth/otp/request', { phone }, {}, ip);
  if (req.statusCode !== 200) throw new Error(`request failed: ${req.body}`);
  const { challengeId } = req.json();
  const e164 = `+251${phone.replace(/\D/g, '').slice(-9)}`;
  const res = await t.post('/api/auth/otp/verify', { challengeId, code: t.sms.lastCodeFor(e164) });
  if (res.statusCode !== 200) throw new Error(`verify failed: ${res.body}`);
  return { cookie: sessionCookie(res), body: res.json(), res };
}
