// Destination workflow: "End delivery" calculates the final fare from the actual route and time,
// the selected payer is told the price, the rider records the payment outcome, and "Done"
// completes the delivery (commission + point exactly once).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { haversineKm } from '@dp/shared';
import {
  adminAuditLog,
  deliveries,
  payments,
  pricingRules,
  riderLedger,
  riderPoints,
  riders,
  users,
} from '../src/db/schema.ts';
import { computeFinalFare } from '../src/modules/pricing/pricing.ts';
import { PayerNotifier } from '../src/modules/deliveries/payerNotice.ts';
import { FakeSmsProvider } from '../src/integrations/sms/fake.ts';
import { createTestApp, ORIGIN, signIn, type TestApp } from './helpers.ts';

let t: TestApp;
let ip = 0;
const nextIp = () => `10.70.${Math.floor(++ip / 250)}.${ip % 250}`;

beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const MESKEL = { lat: 9.0105, lng: 38.7614 };
const PIASSA = { lat: 9.0326, lng: 38.7541 };
const RECEIVER = '0922222222';
const RECEIVER_E164 = '+251922222222';

const call = (method: 'GET' | 'POST', url: string, cookie: string, payload?: unknown) =>
  t.app.inject({
    method,
    url,
    headers: { cookie, origin: ORIGIN },
    ...(payload ? { payload: payload as object } : {}),
  });

let phoneN = 0;
const phone = (prefix: string) => `${prefix}${String(++phoneN).padStart(4, '0')}`;

async function customer(number = phone('091300')) {
  const s = await signIn(t, number, nextIp());
  return { id: s.body.user.id as string, cookie: s.cookie, phone: s.body.user.phone as string };
}
async function admin() {
  const s = await signIn(t, phone('095700'), nextIp());
  await t.database.db.update(users).set({ role: 'admin' }).where(eq(users.id, s.body.user.id));
  return { id: s.body.user.id as string, cookie: s.cookie };
}
async function rider() {
  const s = await signIn(t, phone('094600'), nextIp());
  await call('POST', '/api/rider/apply', s.cookie, {
    fullName: 'Pay Rider',
    vehicleType: 'motorcycle',
    plateNumber: `3-C${phoneN}`,
  });
  await t.database.db
    .update(riders)
    .set({ approvalStatus: 'approved', kycStatus: 'approved' })
    .where(eq(riders.userId, s.body.user.id));
  return { id: s.body.user.id as string, cookie: s.cookie };
}

let keyN = 0;
async function book(c: { cookie: string }, payer: 'sender' | 'receiver' = 'sender') {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/deliveries',
    headers: { cookie: c.cookie, origin: ORIGIN, 'idempotency-key': `dp-key-${++keyN}` },
    payload: {
      pickup: { ...MESKEL, address: 'Meskel Square', contactName: 'Hana', contactPhone: '0911111111' },
      dropoff: { ...PIASSA, address: 'Piassa', contactName: 'Abel', contactPhone: RECEIVER },
      vehicleType: 'motorcycle',
      payer,
      preferredPaymentMethod: 'cash',
      parcel: { description: 'Docs', size: 'small' },
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; code: string; fare: string };
}

const row = async (id: string) =>
  (await t.database.db.select().from(deliveries).where(eq(deliveries.id, id)))[0]!;
const step = (r: { cookie: string }, id: string, to: string) =>
  call('POST', `/api/rider/jobs/${id}/step`, r.cookie, { to });
const pay = (r: { cookie: string }, id: string, body: Record<string, unknown>) =>
  call('POST', `/api/rider/jobs/${id}/payment`, r.cookie, body);
const done = (r: { cookie: string }, id: string) =>
  call('POST', `/api/rider/jobs/${id}/complete`, r.cookie, { handoverConfirmed: true });

/** GPS fixes along a straight line, `n` fixes `everySec` apart starting at `fromSec` from now. */
function line(a: { lat: number; lng: number }, b: { lat: number; lng: number }, n: number, everySec: number, fromSec = 5) {
  return Array.from({ length: n }, (_, i) => {
    const f = i / (n - 1);
    return {
      lat: a.lat + (b.lat - a.lat) * f,
      lng: a.lng + (b.lng - a.lng) * f,
      recordedAt: new Date(t.clock.now().getTime() + (fromSec + i * everySec) * 1000).toISOString(),
      accuracyM: 8,
    };
  });
}

/** Claims the job from the pool and rides to pickup and through pickup. */
async function pickedUp(payer: 'sender' | 'receiver' = 'sender') {
  const c = await customer();
  const r = await rider();
  const d = await book(c, payer);
  expect((await call('POST', `/api/rider/pool/${d.id}/claim`, r.cookie)).statusCode).toBe(200);
  await step(r, d.id, 'arrived_pickup');
  // Collecting before the destination is refused, whoever pays.
  expect((await pay(r, d.id, { method: 'cash' })).json().error.code).toBe('PAYMENT_NOT_ALLOWED');
  expect((await step(r, d.id, 'picked_up')).statusCode).toBe(200);
  return { c, r, d };
}

/** Records the real route, waits `minutes`, then ends the delivery. */
async function ride(r: { cookie: string }, id: string, minutes = 10) {
  const pts = line(MESKEL, PIASSA, 11, 10);
  await call('POST', `/api/rider/jobs/${id}/route`, r.cookie, { points: pts });
  t.clock.advanceSeconds(minutes * 60);
  const end = await step(r, id, 'arrived_dropoff');
  expect(end.statusCode).toBe(200);
  return { job: end.json(), pts };
}

// ── Final fare ───────────────────────────────────────────────────────────────

describe('final fare at the destination', () => {
  it('uses the actual distance and journey time with the booking’s pricing rule', async () => {
    await t.database.db.update(pricingRules).set({ perMinute: '2.00' }).where(isNull(pricingRules.effectiveTo));
    const { r, d } = await pickedUp();
    const before = await row(d.id);
    const { job, pts } = await ride(r, d.id, 12);
    const after = await row(d.id);

    let km = 0;
    for (let i = 1; i < pts.length; i++) km += haversineKm(pts[i - 1]!, pts[i]!);
    expect(after.fareBasis).toBe('gps');
    expect(after.actualDistanceKm).toBeCloseTo(km, 1);
    expect(after.actualDurationMin).toBe(12);
    expect(after.estimatedFare).toBe(before.fareAmount);
    const [rule] = await t.database.db.select().from(pricingRules).where(eq(pricingRules.id, before.pricingRuleId));
    const expected = computeFinalFare(rule!, after.actualDistanceKm!, 12, before.commissionRate);
    expect(after.fareAmount).toBe(expected.fare);
    expect(after.commissionAmount).toBe(expected.commissionAmount);
    expect(after.riderEarning).toBe(expected.riderEarning);
    // The rider's screen shows exactly that fare; there is no way to send a different amount.
    expect(job.finalFare).toMatchObject({ fare: expected.fare, basis: 'gps', actualDurationMin: 12 });
    expect(job.status).toBe('arrived_dropoff');
  });

  it('falls back to the booking distance (still with real time) when GPS is missing', async () => {
    const { r, d } = await pickedUp();
    t.clock.advanceSeconds(8 * 60);
    await step(r, d.id, 'arrived_dropoff');
    const after = await row(d.id);
    expect(after.fareBasis).toBe('estimate');
    expect(after.actualDistanceKm).toBe(after.distanceKm);
    expect(after.actualDurationMin).toBe(8);
  });

  it('caps an implausibly long GPS route', async () => {
    const { r, d } = await pickedUp();
    // A long zig-zag: ~4× the planned distance.
    const far = { lat: 9.0105 + 0.06, lng: 38.7614 };
    const pts = [...line(MESKEL, far, 8, 20), ...line(far, PIASSA, 8, 20, 5 + 8 * 20)];
    await call('POST', `/api/rider/jobs/${d.id}/route`, r.cookie, { points: pts });
    t.clock.advanceSeconds(15 * 60);
    await step(r, d.id, 'arrived_dropoff');
    const after = await row(d.id);
    expect(after.actualDistanceKm).toBeLessThanOrEqual(Math.max(after.distanceKm * 2, after.distanceKm + 3) + 0.01);
  });
});

// ── Notifications ────────────────────────────────────────────────────────────

describe('telling the selected payer', () => {
  it('sender pays: the SMS goes to the sender, never the receiver', async () => {
    const { c, r, d } = await pickedUp('sender');
    const before = t.sms.sent.length;
    await ride(r, d.id);
    const sent = t.sms.sent.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(c.phone);
    const final = await row(d.id);
    expect(sent[0]!.text).toContain(`#${d.code}`);
    expect(sent[0]!.text).toContain(`${final.fareAmount} ETB`);
    expect(t.sms.countFor(RECEIVER_E164)).toBe(0);
    expect(final.payerNotifiedAt).not.toBeNull();
    // The sender sees the final price and payment status in their delivery details.
    const mine = (await call('GET', `/api/deliveries/${d.id}`, c.cookie)).json();
    expect(mine.finalFare).toMatchObject({ fare: final.fareAmount });
    expect(mine.status).toBe('arrived_dropoff');
  });

  it('receiver pays: the SMS goes to the receiver; their link shows the price without the app', async () => {
    const { c, r, d } = await pickedUp('receiver');
    const before = t.sms.sent.length;
    await ride(r, d.id);
    const sent = t.sms.sent.slice(before);
    expect(sent.map((m) => m.to)).toEqual([RECEIVER_E164]);
    expect(t.sms.countFor(c.phone)).toBe(1); // only the sign-in code, no price SMS
    const pub = await t.get(`/api/track/${d.code}`);
    const final = await row(d.id);
    expect(pub.json().payment).toMatchObject({ payer: 'receiver', status: 'due', finalFare: { fare: final.fareAmount } });
    expect(pub.body).not.toContain('922222222');
  });

  it('the public page shows no price before the destination', async () => {
    const { d } = await pickedUp('receiver');
    expect((await t.get(`/api/track/${d.code}`)).json().payment).toBeNull();
  });

  it('in-app notice goes to the payer’s account only (receiver with or without an account)', async () => {
    const notices: Array<{ userId: string; data: Record<string, unknown> }> = [];
    const realtime = {
      deliveryChanged: async () => {},
      publish: () => {},
      notifyUser: (userId: string, _type: string, data: Record<string, unknown> = {}) => {
        notices.push({ userId, data });
      },
    };
    const sms = new FakeSmsProvider();
    const notifier = new PayerNotifier({ db: t.database.db, sms, realtime, appOrigin: 'https://x.test' });

    // Receiver without an account: SMS only.
    const { r, d } = await pickedUp('receiver');
    await ride(r, d.id);
    await t.database.db.update(deliveries).set({ payerNotifiedAt: null }).where(eq(deliveries.id, d.id));
    expect(await notifier.finalPrice(d.id, t.clock.now())).toBe(true);
    expect(notices).toHaveLength(0);
    expect(sms.sent[0]!.to).toBe(RECEIVER_E164);
    expect(sms.sent[0]!.text).toContain(`https://x.test/t/${d.code}`);

    // The receiver signs up: now they also get an in-app notice. The sender never does.
    const receiver = await customer(RECEIVER);
    await t.database.db.update(deliveries).set({ payerNotifiedAt: null }).where(eq(deliveries.id, d.id));
    await notifier.finalPrice(d.id, t.clock.now());
    expect(notices.map((n) => n.userId)).toEqual([receiver.id]);
    expect(notices[0]!.data).toMatchObject({ kind: 'payment_due', code: d.code, deliveryId: null });

    // A payer is told once: a repeat does not send a second SMS.
    expect(await notifier.finalPrice(d.id, t.clock.now())).toBe(false);
    expect(sms.sent).toHaveLength(2);
  });
});

// ── Payment and Done ─────────────────────────────────────────────────────────

describe('payment outcome and Done', () => {
  it('cash: rider-confirmed, no further check needed; Done completes once', async () => {
    const { c, r, d } = await pickedUp();
    await ride(r, d.id);
    // Done is refused until the payment is recorded.
    expect((await done(r, d.id)).json().error.code).toBe('PAYMENT_REQUIRED');
    expect((await call('POST', `/api/rider/jobs/${d.id}/complete`, r.cookie, {})).statusCode).toBe(400);
    const p = await pay(r, d.id, { method: 'cash', amount: '1.00' });
    expect(p.statusCode).toBe(200);
    expect(p.json().farePayment).toMatchObject({ status: 'collected', method: 'cash', verification: 'not_required' });
    const [payment] = await t.database.db.select().from(payments).where(eq(payments.deliveryId, d.id));
    expect(payment!.amount).toBe((await row(d.id)).fareAmount); // never a client amount

    // Triple tap / retries: one completion, one commission, one point.
    const results = await Promise.all([done(r, d.id), done(r, d.id), done(r, d.id)]);
    expect(results.map((x) => x.statusCode)).toEqual([200, 200, 200]);
    expect(results.every((x) => x.json().status === 'delivered')).toBe(true);
    const final = await row(d.id);
    expect(final.status).toBe('delivered');
    expect(final.deliveredAt).not.toBeNull();
    const ledger = await t.database.db.select().from(riderLedger).where(eq(riderLedger.deliveryId, d.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.amount).toBe(final.commissionAmount);
    const pts = await t.database.db
      .select()
      .from(riderPoints)
      .where(and(eq(riderPoints.deliveryId, d.id), eq(riderPoints.type, 'completion')));
    expect(pts).toHaveLength(1);
    expect((await done(r, d.id)).statusCode).toBe(200);
    expect(await t.database.db.select().from(riderLedger).where(eq(riderLedger.deliveryId, d.id))).toHaveLength(1);
    // The rider is free again; the customer sees it completed and paid.
    const home = (await call('GET', '/api/rider/home', r.cookie)).json();
    expect(home.job).toBeNull();
    const mine = (await call('GET', `/api/deliveries/${d.id}`, c.cookie)).json();
    expect(mine.farePayment).toMatchObject({ status: 'collected', method: 'cash' });
  });

  it('Telebirr / CBE Birr: transaction ID required; Done never marks them verified', async () => {
    for (const method of ['telebirr', 'cbe_birr'] as const) {
      const { r, d } = await pickedUp('receiver');
      await ride(r, d.id);
      expect((await pay(r, d.id, { method })).statusCode).toBe(400);
      const p = await pay(r, d.id, { method, reference: 'TX-998877' });
      expect(p.json().farePayment).toMatchObject({ status: 'collected', method, verification: 'pending' });
      expect((await done(r, d.id)).statusCode).toBe(200);
      const [payment] = await t.database.db.select().from(payments).where(eq(payments.deliveryId, d.id));
      expect(payment).toMatchObject({ status: 'collected', verification: 'pending', payer: 'receiver' });
    }
  });

  it('an admin verifies a transfer independently, once, with an audit record', async () => {
    const a = await admin();
    const { r, d } = await pickedUp();
    await ride(r, d.id);
    await pay(r, d.id, { method: 'telebirr', reference: 'TB-111' });
    await done(r, d.id);
    const [payment] = await t.database.db.select().from(payments).where(eq(payments.deliveryId, d.id));
    expect((await call('POST', `/api/admin/payments/${payment!.id}/verify`, r.cookie, { decision: 'verify' })).statusCode).toBe(403);
    const ok = await call('POST', `/api/admin/payments/${payment!.id}/verify`, a.cookie, { decision: 'verify' });
    expect(ok.statusCode).toBe(204);
    const again = await call('POST', `/api/admin/payments/${payment!.id}/verify`, a.cookie, { decision: 'verify' });
    expect(again.json().error.code).toBe('NOT_PENDING');
    const [after] = await t.database.db.select().from(payments).where(eq(payments.id, payment!.id));
    expect(after).toMatchObject({ verification: 'verified', verifiedBy: a.id });
    const log = await t.database.db.select().from(adminAuditLog).where(eq(adminAuditLog.action, 'payment.verified'));
    expect(log).toHaveLength(1);
    const detail = (await call('GET', `/api/admin/deliveries/${d.id}`, a.cookie)).json();
    expect(detail.finalFare).not.toBeNull();
    expect(detail.money.estimatedFare).toBeDefined();
    expect(detail.deliveredAt).not.toBeNull();
    expect(detail.payments[0]).toMatchObject({ verification: 'verified', payer: 'sender' });
  });

  it('disputed: needs a note, may be upgraded to collected, and an admin can resolve it', async () => {
    const a = await admin();
    const { r, d } = await pickedUp();
    await ride(r, d.id);
    expect((await pay(r, d.id, { method: 'telebirr', outcome: 'disputed' })).statusCode).toBe(400);
    const disputed = await pay(r, d.id, {
      method: 'telebirr',
      outcome: 'disputed',
      note: 'Sender says they sent it; not received yet',
    });
    expect(disputed.json().farePayment).toMatchObject({ status: 'disputed', verification: 'pending' });
    // The money arrives after all.
    const collected = await pay(r, d.id, { method: 'telebirr', reference: 'TB-222' });
    expect(collected.json().farePayment).toMatchObject({ status: 'collected', verification: 'pending' });

    // A second job left disputed: the rider may still close it (admin follows up).
    const second = await pickedUp();
    await ride(second.r, second.d.id);
    await pay(second.r, second.d.id, { method: 'cbe_birr', outcome: 'disputed', note: 'Transfer not visible' });
    expect((await done(second.r, second.d.id)).statusCode).toBe(200);
    const [p] = await t.database.db.select().from(payments).where(eq(payments.deliveryId, second.d.id));
    expect(p!.status).toBe('disputed');
    const res = await call('POST', `/api/admin/payments/${p!.id}/resolve`, a.cookie, {
      status: 'collected',
      method: 'cbe_birr',
      note: 'Found in statement',
    });
    expect(res.statusCode).toBe(204);
  });

  it('Done is refused before the destination', async () => {
    const { r, d } = await pickedUp();
    expect((await done(r, d.id)).json().error.code).toBe('INVALID_STEP');
  });

  it('a rider cannot take another job until the current one is closed', async () => {
    const { r, d } = await pickedUp();
    await ride(r, d.id);
    const other = await book(await customer());
    const claim = await call('POST', `/api/rider/pool/${other.id}/claim`, r.cookie);
    expect(claim.statusCode).toBe(409);
    expect((await call('GET', '/api/rider/pool', r.cookie)).json().blockedReason).toBe('busy');
    await pay(r, d.id, { method: 'cash' });
    await done(r, d.id);
    // Closed: free again (after topping up the prepaid wallet the commission came out of).
    const a = await admin();
    const credit = await call('POST', `/api/admin/riders/${r.id}/wallet/adjust`, a.cookie, {
      amount: '100',
      reason: 'Test top-up',
    });
    expect(credit.statusCode).toBe(200);
    expect((await call('POST', `/api/rider/pool/${other.id}/claim`, r.cookie)).statusCode).toBe(200);
  });

  it('commission is never charged for a failed delivery', async () => {
    const { r, d } = await pickedUp();
    await ride(r, d.id);
    for (let i = 0; i < 3; i++) {
      await call('POST', `/api/rider/jobs/${d.id}/contact-attempts`, r.cookie, { outcome: 'no_answer' });
      t.clock.advanceSeconds(301);
    }
    expect((await call('POST', `/api/rider/jobs/${d.id}/fail`, r.cookie)).statusCode).toBe(200);
    expect(await t.database.db.select().from(riderLedger).where(eq(riderLedger.deliveryId, d.id))).toHaveLength(0);
  });
});
