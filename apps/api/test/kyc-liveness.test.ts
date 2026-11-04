// Rider KYC face liveness: server-issued randomized challenge, ordered steps within a time limit,
// frames only from a live session, threshold checks, replay prevention, and manual approval.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { DEFAULT_LIVENESS } from '@dp/shared';
import { kycDocuments, kycLivenessSessions, riders, users } from '../src/db/schema.ts';
import { rejectReason, reviewFlags } from '../src/modules/kyc/liveness.ts';
import {
  createTestApp,
  fakeJpeg,
  goodLivenessMetrics,
  ORIGIN,
  passLiveness,
  signIn,
  submitKyc,
  type TestApp,
} from './helpers.ts';

let t: TestApp;
let n = 0;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const call = (method: 'GET' | 'POST' | 'PUT', url: string, cookie: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie, origin: ORIGIN }, ...(payload ? { payload: payload as object } : {}) });

async function rider() {
  const s = await signIn(t, `09450${String(++n).padStart(5, '0')}`, `10.80.0.${n}`);
  await call('POST', '/api/rider/apply', s.cookie, { fullName: 'Live Rider', vehicleType: 'bicycle' });
  return { id: s.body.user.id as string, cookie: s.cookie };
}
async function admin() {
  const s = await signIn(t, `09550${String(++n).padStart(5, '0')}`, `10.80.1.${n}`);
  await t.database.db.update(users).set({ role: 'admin' }).where(eq(users.id, s.body.user.id));
  return { cookie: s.cookie };
}
const start = async (cookie: string) => (await call('POST', '/api/rider/kyc/liveness', cookie)).json();
function step(cookie: string, id: string, index: number, action: string, over: Record<string, unknown> = {}) {
  t.clock.advanceSeconds(2);
  const now = t.clock.now().getTime();
  return call('POST', `/api/rider/kyc/liveness/${id}/steps`, cookie, {
    index,
    action,
    startedAt: new Date(now - 1500).toISOString(),
    completedAt: new Date(now).toISOString(),
    metrics: { ...goodLivenessMetrics(action), ...((over.metrics as object) ?? {}) },
    ...(action === 'center' ? {} : { image: fakeJpeg() }),
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'metrics')),
  });
}

describe('challenge', () => {
  it('is look straight → right/left in random order → back to centre, with an expiry', async () => {
    const r = await rider();
    const orders = new Set<string>();
    for (let i = 0; i < 16; i++) {
      const s = await start(r.cookie);
      expect(s.sequence[0]).toBe('straight');
      expect(s.sequence[3]).toBe('center');
      expect([...s.sequence.slice(1, 3)].sort()).toEqual(['left', 'right']);
      expect(new Date(s.expiresAt).getTime()).toBe(t.clock.now().getTime() + DEFAULT_LIVENESS.sessionSeconds * 1000);
      orders.add(s.sequence.join());
    }
    expect(orders.size).toBe(2);
    // Only the newest session is open.
    const open = await t.database.db.select().from(kycLivenessSessions).where(eq(kycLivenessSessions.status, 'active'));
    expect(open).toHaveLength(1);
  });

  it('face photos cannot be uploaded; submitting needs a passed live check', async () => {
    const r = await rider();
    const up = await call('PUT', '/api/rider/kyc/documents/face_front', r.cookie, { image: fakeJpeg() });
    expect(up.json().error.code).toBe('LIVENESS_REQUIRED');
    for (const k of ['id_front', 'id_back']) {
      expect((await call('PUT', `/api/rider/kyc/documents/${k}`, r.cookie, { image: fakeJpeg() })).statusCode).toBe(200);
    }
    expect((await call('POST', '/api/rider/kyc/submit', r.cookie)).statusCode).toBe(409);
    const { last } = await passLiveness(t, r.cookie);
    expect(last.status).toBe('passed');
    const view = (await call('GET', '/api/rider/kyc', r.cookie)).json();
    expect(view.livenessPassed).toBe(true);
    const sub = await call('POST', '/api/rider/kyc/submit', r.cookie);
    expect(sub.statusCode).toBe(200);
    // Passing the face check never approves anyone: an admin still decides.
    expect(sub.json().status).toBe('pending_review');
    const [row] = await t.database.db.select().from(riders).where(eq(riders.userId, r.id));
    expect(row!.approvalStatus).toBe('pending');
    // Frames are stored encrypted and bound to the session.
    const faces = await t.database.db.select().from(kycDocuments).where(eq(kycDocuments.riderId, r.id));
    const sessions = new Set(faces.filter((f) => f.kind.startsWith('face_')).map((f) => f.livenessSessionId));
    expect(sessions.size).toBe(1);
    expect([...sessions][0]).not.toBeNull();
  });
});

describe('steps', () => {
  it('must follow the issued order', async () => {
    const r = await rider();
    const s = await start(r.cookie);
    const wrong = await step(r.cookie, s.id, 0, s.sequence[1]);
    expect(wrong.json().error.code).toBe('LIVENESS_ORDER');
    expect((await step(r.cookie, s.id, 1, s.sequence[1])).json().error.code).toBe('LIVENESS_ORDER');
    expect((await step(r.cookie, s.id, 0, 'straight')).statusCode).toBe(200);
  });

  it('rejects poses that do not meet the thresholds, and counts the attempts', async () => {
    const r = await rider();
    const s = await start(r.cookie);
    const turn = s.sequence[1] as 'right' | 'left';
    const weakYaw = turn === 'right' ? 10 : -10;
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ faceCount: 2 }, 'More than one face'],
      [{ faceCount: 0 }, 'No face'],
      [{ faceArea: 0.01 }, 'Move closer'],
      [{ holdMs: 100 }, 'Hold the position'],
      [{ pitchDeg: 40 }, 'Keep your head level'],
    ];
    for (const [metrics, msg] of cases) {
      const res = await step(r.cookie, s.id, 0, 'straight', { metrics });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.message).toContain(msg);
    }
    expect((await step(r.cookie, s.id, 0, 'straight', { metrics: { yawDeg: 25 } })).json().error.message).toContain('Look straight');
    expect((await step(r.cookie, s.id, 0, 'straight')).statusCode).toBe(200);
    expect((await step(r.cookie, s.id, 1, turn, { metrics: { yawDeg: weakYaw } })).json().error.message).toContain('further');
    // Moving the phone around a still face slides it across the frame.
    expect((await step(r.cookie, s.id, 1, turn, { metrics: { faceShift: 0.5 } })).json().error.message).toContain('turn only your head');
    // A jump no real head makes (spliced / switched video).
    expect((await step(r.cookie, s.id, 1, turn, { metrics: { maxStepDeg: 60 } })).json().error.message).toContain('not continuous');
    const [row] = await t.database.db.select().from(kycLivenessSessions).where(eq(kycLivenessSessions.id, s.id));
    expect(row!.failedAttempts).toBe(9);
    expect(row!.status).toBe('active');
  });

  it('a face action without a frame is refused', async () => {
    const r = await rider();
    const s = await start(r.cookie);
    const res = await call('POST', `/api/rider/kyc/liveness/${s.id}/steps`, r.cookie, {
      index: 0,
      action: 'straight',
      startedAt: t.clock.now().toISOString(),
      completedAt: t.clock.now().toISOString(),
      metrics: goodLivenessMetrics('straight'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('expires, and cannot be replayed or used by another rider', async () => {
    const r = await rider();
    const other = await rider();
    const s = await start(r.cookie);
    expect((await step(other.cookie, s.id, 0, 'straight')).statusCode).toBe(404);
    t.clock.advanceSeconds(DEFAULT_LIVENESS.sessionSeconds + 1);
    expect((await step(r.cookie, s.id, 0, 'straight')).json().error.code).toBe('LIVENESS_EXPIRED');

    const { session } = await passLiveness(t, r.cookie);
    // Replaying a step of a finished session is refused.
    expect((await step(r.cookie, session.id, 0, 'straight')).json().error.code).toBe('LIVENESS_CLOSED');
    // A superseded challenge cannot be answered either.
    const old = await start(r.cookie);
    await start(r.cookie);
    expect((await step(r.cookie, old.id, 0, 'straight')).json().error.code).toBe('LIVENESS_CLOSED');
  });

  it('a whole sequence completed implausibly fast fails', async () => {
    const r = await rider();
    const s = await start(r.cookie);
    const now = t.clock.now().getTime();
    let res;
    for (const [index, action] of (s.sequence as string[]).entries()) {
      res = await call('POST', `/api/rider/kyc/liveness/${s.id}/steps`, r.cookie, {
        index,
        action,
        startedAt: new Date(now + index * 200).toISOString(),
        completedAt: new Date(now + index * 200 + 100).toISOString(),
        metrics: goodLivenessMetrics(action),
        ...(action === 'center' ? {} : { image: fakeJpeg() }),
      });
    }
    expect(res!.json().error.message).toContain('too fast');
    const [row] = await t.database.db.select().from(kycLivenessSessions).where(eq(kycLivenessSessions.id, s.id));
    expect(row!.status).toBe('failed');
  });

  it('thresholds are configurable by an admin', async () => {
    const a = await admin();
    const res = await call('PUT', '/api/admin/settings/platform', a.cookie, {
      liveness: { turnYawDeg: 35 },
      reason: 'Calibrated on test phones',
    });
    expect(res.json().liveness.turnYawDeg).toBe(35);
    const r = await rider();
    const s = await start(r.cookie);
    expect(s.thresholds.turnYawDeg).toBe(35);
    await step(r.cookie, s.id, 0, 'straight');
    const turn = s.sequence[1];
    expect((await step(r.cookie, s.id, 1, turn)).statusCode).toBe(422); // 30° no longer enough
    expect((await step(r.cookie, s.id, 1, turn, { metrics: { yawDeg: turn === 'right' ? 38 : -38 } })).statusCode).toBe(200);
  });
});

describe('admin review', () => {
  it('shows the steps, timestamps and review signals next to the frames; approval stays manual', async () => {
    const a = await admin();
    const r = await rider();
    await submitKyc(t, r.cookie);
    const detail = (await call('GET', `/api/admin/riders/${r.id}/kyc`, a.cookie)).json();
    expect(detail.liveness).toMatchObject({ status: 'passed', failedAttempts: 0 });
    expect(detail.liveness.steps).toHaveLength(4);
    expect(detail.liveness.steps.map((s: { action: string }) => s.action)).toEqual(detail.liveness.sequence);
    expect(detail.liveness.steps[0].metrics).toMatchObject({ faceCount: 1 });
    expect(detail.kycStatus).toBe('pending_review');
    expect((await call('GET', `/api/admin/riders/${r.id}/kyc`, r.cookie)).statusCode).toBe(403);
    const ok = await call('POST', `/api/admin/riders/${r.id}/kyc/decision`, a.cookie, { decision: 'approve' });
    expect(ok.statusCode).toBe(204);
  });

  it('rejection deletes the face-check records with the photos', async () => {
    const a = await admin();
    const r = await rider();
    await submitKyc(t, r.cookie);
    await call('POST', `/api/admin/riders/${r.id}/kyc/decision`, a.cookie, { decision: 'reject', reason: 'Blurry ID' });
    expect(await t.database.db.select().from(kycLivenessSessions).where(eq(kycLivenessSessions.riderId, r.id))).toHaveLength(0);
  });
});

describe('rules (unit)', () => {
  const m = (action: string, over = {}) => ({ ...goodLivenessMetrics(action), ...over });
  it('accepts good poses for each action', () => {
    for (const a of ['straight', 'right', 'left', 'center'] as const) {
      expect(rejectReason(a, m(a), DEFAULT_LIVENESS)).toBeNull();
    }
  });
  it('right is positive yaw, left is negative', () => {
    expect(rejectReason('right', m('left'), DEFAULT_LIVENESS)).not.toBeNull();
    expect(rejectReason('left', m('right'), DEFAULT_LIVENESS)).not.toBeNull();
  });
  it('flags a static face, no blinks and abrupt movement for the reviewer', () => {
    const steps = ['straight', 'right', 'left', 'center'].map((action, i) => ({
      index: i,
      action: action as 'straight',
      startedAt: new Date(1000 * i * 3).toISOString(),
      completedAt: new Date(1000 * i * 3 + 1000).toISOString(),
      receivedAt: new Date().toISOString(),
      metrics: m(action, { jitterDeg: 0.05, blinks: 0, maxStepDeg: 30 }),
    }));
    expect(reviewFlags(steps, 6).sort()).toEqual(['abrupt_movement', 'many_failed_attempts', 'no_blink', 'static_face']);
  });
});
