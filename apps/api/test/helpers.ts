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
  const { app, dispatcher } = await buildApp({
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
