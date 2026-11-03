// Rider features: service areas and home, the offer pool, points, ratings, the prepaid commission
// wallet, GPS route recording and delivery history, matching, and admin-only access.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { pickupArea } from '@dp/shared';
import {
  adminAuditLog,
  deliveries,
  deliveryEvents,
  deliveryOffers,
  riderLedger,
  riders,
  users,
} from '../src/db/schema.ts';
import { createTestApp, ORIGIN, signIn, type TestApp } from './helpers.ts';

let t: TestApp;
let ip = 0;
const nextIp = () => `10.60.${Math.floor(++ip / 250)}.${ip % 250}`;

beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const MESKEL = { lat: 9.0105, lng: 38.7614 };
const PIASSA = { lat: 9.0326, lng: 38.7541 };

const call = (
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  cookie: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) =>
  t.app.inject({
    method,
    url,
    headers: { cookie, origin: ORIGIN, ...headers },
    ...(payload ? { payload: payload as object } : {}),
  });

let phoneN = 0;
const phone = (prefix: string) => `${prefix}${String(++phoneN).padStart(4, '0')}`;

async function customer() {
  const s = await signIn(t, phone('091200'), nextIp());
  return { id: s.body.user.id as string, cookie: s.cookie };
}
async function admin() {
  const s = await signIn(t, phone('095600'), nextIp());
  await t.database.db.update(users).set({ role: 'admin' }).where(eq(users.id, s.body.user.id));
  return { id: s.body.user.id as string, cookie: s.cookie };
}
/** Approved rider. Offline by default here, so bookings stay in the pool instead of being pushed. */
async function rider(opts: { vehicle?: 'motorcycle' | 'bicycle'; online?: boolean } = {}) {
  const s = await signIn(t, phone('094500'), nextIp());
  const vehicle = opts.vehicle ?? 'motorcycle';
  await call('POST', '/api/rider/apply', s.cookie, {
    fullName: 'Pool Rider',
    vehicleType: vehicle,
    plateNumber: vehicle === 'motorcycle' ? `3-B${phoneN}` : undefined,
  });
  await t.database.db
    .update(riders)
    .set({ approvalStatus: 'approved', kycStatus: 'approved' })
    .where(eq(riders.userId, s.body.user.id));
  if (opts.online) {
    await call('POST', '/api/rider/status', s.cookie, { online: true });
    await call('POST', '/api/rider/location', s.cookie, MESKEL);
  }
  return { id: s.body.user.id as string, cookie: s.cookie };
}

let keyN = 0;
async function book(c: { cookie: string }, vehicle: 'motorcycle' | 'bicycle' = 'motorcycle') {
  const res = await call(
    'POST',
    '/api/deliveries',
    c.cookie,
    {
      pickup: { ...MESKEL, address: 'Meskel Square', contactName: 'Hana', contactPhone: '0911111111' },
      dropoff: { ...PIASSA, address: 'Piassa', contactName: 'Abel', contactPhone: '0922222222' },
      vehicleType: vehicle,
      payer: 'sender',
      preferredPaymentMethod: 'cash',
      parcel: { description: 'Docs', size: 'small' },
    },
    { 'idempotency-key': `rf-key-${++keyN}` },
  );
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; code: string; fare: string };
}

const row = async (id: string) =>
  (await t.database.db.select().from(deliveries).where(eq(deliveries.id, id)))[0]!;
const areaOf = async (id: string) => {
  const d = await row(id);
  return pickupArea(d.pickupSubCity, { lat: d.pickupLat, lng: d.pickupLng });
};
const claim = (r: { cookie: string }, id: string) => call('POST', `/api/rider/pool/${id}/claim`, r.cookie);
const step = (r: { cookie: string }, id: string, to: string) =>
  call('POST', `/api/rider/jobs/${id}/step`, r.cookie, { to });
async function deliver(r: { cookie: string }, id: string) {
  for (const s of ['arrived_pickup', 'picked_up', 'arrived_dropoff']) {
    expect((await step(r, id, s)).statusCode).toBe(200);
  }
  await call('POST', `/api/rider/jobs/${id}/payment`, r.cookie, { method: 'cash' });
  const done = await step(r, id, 'delivered');
  expect(done.statusCode).toBe(200);
}
const standing = async (r: { cookie: string }) =>
  (await call('GET', '/api/rider/standing', r.cookie)).json();
const wallet = async (r: { cookie: string }) => (await call('GET', '/api/rider/wallet', r.cookie)).json();

// ── Service areas and home ───────────────────────────────────────────────────

describe('service areas and home location', () => {
  it('saves areas and home, validates them, and lets the rider clear the home', async () => {
    const r = await rider();
    expect((await call('GET', '/api/rider/preferences', r.cookie)).json()).toEqual({
      serviceAreas: [],
      home: null,
    });
    const saved = await call('PUT', '/api/rider/preferences', r.cookie, {
      serviceAreas: ['bole', 'kirkos'],
      home: { lat: 9.0, lng: 38.78, radiusKm: 4 },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().serviceAreas.sort()).toEqual(['bole', 'kirkos']);
    expect(saved.json().home).toMatchObject({ radiusKm: 4 });

    const badArea = await call('PUT', '/api/rider/preferences', r.cookie, {
      serviceAreas: ['atlantis'],
      home: null,
    });
    expect(badArea.statusCode).toBe(400);
    const farHome = await call('PUT', '/api/rider/preferences', r.cookie, {
      serviceAreas: [],
      home: { lat: 7.05, lng: 38.47, radiusKm: 3 },
    });
    expect(farHome.statusCode).toBe(400);

    const cleared = await call('PUT', '/api/rider/preferences', r.cookie, {
      serviceAreas: ['bole'],
      home: null,
    });
    expect(cleared.json()).toEqual({ serviceAreas: ['bole'], home: null });
  });

  it('only riders can read or change preferences', async () => {
    const c = await customer();
    expect((await call('GET', '/api/rider/preferences', c.cookie)).statusCode).toBe(403);
    expect(
      (await call('PUT', '/api/rider/preferences', c.cookie, { serviceAreas: [], home: null }))
        .statusCode,
    ).toBe(403);
  });

  it('push offers go only to riders covering the pickup area (or with no areas set)', async () => {
    const c = await customer();
    const outside = await rider({ online: true });
    // Find the pickup's area with a throwaway booking, then cancel it.
    const probe = await book(c);
    const area = await areaOf(probe.id);
    await call('POST', `/api/deliveries/${probe.id}/cancel`, c.cookie, {});
    const other = area === 'bole' ? 'yeka' : 'bole';
    await call('PUT', '/api/rider/preferences', outside.cookie, { serviceAreas: [other], home: null });
    await t.database.db.delete(deliveryOffers);

    const d = await book(c);
    let offers = await t.database.db.select().from(deliveryOffers).where(eq(deliveryOffers.deliveryId, d.id));
    expect(offers).toHaveLength(0);

    const inside = await rider({ online: true });
    await call('PUT', '/api/rider/preferences', inside.cookie, { serviceAreas: [area], home: null });
    await t.dispatcher.dispatch(d.id);
    offers = await t.database.db.select().from(deliveryOffers).where(eq(deliveryOffers.deliveryId, d.id));
    expect(offers.map((o) => o.riderId)).toEqual([inside.id]);
    // The matching breakdown is stored with the offer, for admins to explain the choice.
    expect(offers[0]!.score).toMatchObject({ total: expect.any(Number) });
  });

  it('a rider’s home is never shown to customers', async () => {
    const r = await rider();
    await call('PUT', '/api/rider/preferences', r.cookie, {
      serviceAreas: [],
      home: { lat: 9.0123, lng: 38.7777, radiusKm: 3 },
    });
    const c = await customer();
    const d = await book(c);
    expect((await claim(r, d.id)).statusCode).toBe(200);
    const view = await call('GET', `/api/deliveries/${d.id}`, c.cookie);
    expect(view.body).not.toContain('38.7777');
    expect(view.body).not.toContain('home');
    const tracking = await t.get(`/api/track/${d.code}`);
    expect(tracking.body).not.toContain('38.7777');
  });
});

// ── Offer pool ───────────────────────────────────────────────────────────────

describe('offer pool', () => {
  it('lists claimable jobs with money and route details, and hides what is not claimable', async () => {
    const c = await customer();
    const r = await rider();
    const bike = await rider({ vehicle: 'bicycle' });
    const d = await book(c);
    const pool = (await call('GET', '/api/rider/pool', r.cookie)).json();
    const offer = pool.offers.find((o: { deliveryId: string }) => o.deliveryId === d.id);
    expect(offer).toMatchObject({
      code: d.code,
      fare: d.fare,
      pickup: { address: 'Meskel Square' },
      dropoff: { address: 'Piassa' },
      vehicleType: 'motorcycle',
    });
    expect(Number(offer.riderEarning)).toBeLessThan(Number(offer.fare));
    // Customer contact details are not exposed before a rider takes the job.
    expect(JSON.stringify(offer)).not.toContain('0911111111');
    expect(JSON.stringify(offer)).not.toContain('Hana');
    // Wrong vehicle: not listed, and a claim is refused.
    const bikePool = (await call('GET', '/api/rider/pool', bike.cookie)).json();
    expect(bikePool.offers).toHaveLength(0);
    expect((await claim(bike, d.id)).json().error.code).toBe('WRONG_VEHICLE');

    // Stale (older than a day): no longer listed.
    t.clock.advanceSeconds(25 * 3600);
    expect((await call('GET', '/api/rider/pool', r.cookie)).json().offers).toHaveLength(0);
  });

  it('a cancelled job is never in the pool', async () => {
    const c = await customer();
    const r = await rider();
    const d = await book(c);
    await call('POST', `/api/deliveries/${d.id}/cancel`, c.cookie, {});
    expect((await call('GET', '/api/rider/pool', r.cookie)).json().offers).toHaveLength(0);
    expect((await claim(r, d.id)).json().error.code).toBe('OFFER_GONE');
  });

  it('exactly one rider wins a simultaneous claim; the others are told it is gone', async () => {
    const c = await customer();
    const d = await book(c);
    const contenders = await Promise.all([rider(), rider(), rider()]);
    const results = await Promise.all(contenders.map((r) => claim(r, d.id)));
    const won = results.filter((x) => x.statusCode === 200);
    expect(won).toHaveLength(1);
    for (const lost of results.filter((x) => x.statusCode !== 200)) {
      expect(lost.statusCode).toBe(409);
      expect(lost.json().error.code).toBe('OFFER_GONE');
    }
    const after = await row(d.id);
    expect(after.status).toBe('assigned');
    const events = await t.database.db
      .select()
      .from(deliveryEvents)
      .where(and(eq(deliveryEvents.deliveryId, d.id), eq(deliveryEvents.toStatus, 'assigned')));
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toMatchObject({ pool: true });
  });

  it('an active job is never reassigned, and a busy rider cannot claim a second', async () => {
    const c = await customer();
    const r1 = await rider();
    const r2 = await rider();
    const a = await book(c);
    const b = await book(c);
    expect((await claim(r1, a.id)).statusCode).toBe(200);
    expect((await claim(r2, a.id)).json().error.code).toBe('OFFER_GONE');
    const busy = await claim(r1, b.id);
    expect(busy.statusCode).toBe(409);
    expect(['RIDER_BUSY', 'OFFER_GONE']).toContain(busy.json().error.code);
    expect((await call('GET', '/api/rider/pool', r1.cookie)).json().blockedReason).toBe('busy');
  });

  it('a job being pushed to another rider is hidden until that offer lapses', async () => {
    const c = await customer();
    const pushed = await rider({ online: true });
    const d = await book(c);
    const [offer] = await t.database.db.select().from(deliveryOffers).where(eq(deliveryOffers.deliveryId, d.id));
    expect(offer?.riderId).toBe(pushed.id);
    const other = await rider();
    expect((await call('GET', '/api/rider/pool', other.cookie)).json().offers).toHaveLength(0);
    expect((await claim(other, d.id)).json().error.code).toBe('OFFER_GONE');
  });

  it('refuses claims outside the rider’s areas and from unapproved riders', async () => {
    const c = await customer();
    const d = await book(c);
    const area = await areaOf(d.id);
    const r = await rider();
    await call('PUT', '/api/rider/preferences', r.cookie, {
      serviceAreas: [area === 'bole' ? 'yeka' : 'bole'],
      home: null,
    });
    expect((await call('GET', '/api/rider/pool', r.cookie)).json().offers).toHaveLength(0);
    expect((await claim(r, d.id)).json().error.code).toBe('OUTSIDE_AREA');

    const pending = await rider();
    await t.database.db.update(riders).set({ approvalStatus: 'pending' }).where(eq(riders.userId, pending.id));
    expect((await claim(pending, d.id)).statusCode).toBe(403);
  });
});

// ── Points ───────────────────────────────────────────────────────────────────

describe('points', () => {
  it('start at 50, +1 per completed delivery, once', async () => {
    const r = await rider();
    expect((await standing(r)).points).toBe(50);
    const d = await book(await customer());
    await claim(r, d.id);
    await deliver(r, d.id);
    await step(r, d.id, 'delivered');
    const s = await standing(r);
    expect(s.points).toBe(51);
    expect(s.pointsHistory.map((p: { type: string }) => p.type).sort()).toEqual(['completion', 'initial']);
  });

  it('−3 only for rider-responsible cancellations', async () => {
    const c = await customer();
    const a = await admin();
    const r = await rider();

    // Customer cancels: not the rider's fault.
    const d1 = await book(c);
    await claim(r, d1.id);
    await call('POST', `/api/deliveries/${d1.id}/cancel`, c.cookie, {});
    expect((await standing(r)).points).toBe(50);

    // Admin cancels without blaming the rider: no change.
    const d2 = await book(c);
    await claim(r, d2.id);
    await call('POST', `/api/admin/deliveries/${d2.id}/cancel`, a.cookie, { reason: 'Customer asked' });
    expect((await standing(r)).points).toBe(50);

    // Rider gives the job back: −3.
    const d3 = await book(c);
    await claim(r, d3.id);
    expect((await call('POST', `/api/rider/jobs/${d3.id}/release`, r.cookie)).statusCode).toBe(200);
    expect((await standing(r)).points).toBe(47);

    // Admin cancels for a rider no-show: −3.
    const d4 = await book(c);
    await claim(r, d4.id);
    await call('POST', `/api/admin/deliveries/${d4.id}/cancel`, a.cookie, {
      reason: 'Rider did not show',
      riderResponsible: true,
    });
    expect((await standing(r)).points).toBe(44);
  });

  it('admin corrections are audited; riders cannot change points', async () => {
    const a = await admin();
    const r = await rider();
    const noReason = await call('POST', `/api/admin/riders/${r.id}/points/adjust`, a.cookie, { delta: 5 });
    expect(noReason.statusCode).toBe(400);
    const ok = await call('POST', `/api/admin/riders/${r.id}/points/adjust`, a.cookie, {
      delta: 5,
      reason: 'Wrongly penalised for a customer cancel',
    });
    expect(ok.json()).toEqual({ points: 55 });
    const log = await t.database.db.select().from(adminAuditLog).where(eq(adminAuditLog.action, 'points.adjust'));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: a.id, targetId: r.id });
    expect(
      (await call('POST', `/api/admin/riders/${r.id}/points/adjust`, r.cookie, { delta: 5, reason: 'Give me points' }))
        .statusCode,
    ).toBe(403);
  });
});

// ── Ratings ──────────────────────────────────────────────────────────────────

describe('ratings', () => {
  it('one rating per delivered delivery, only by its customer', async () => {
    const c = await customer();
    const stranger = await customer();
    const r = await rider();
    const d = await book(c);
    await claim(r, d.id);
    expect((await call('POST', `/api/deliveries/${d.id}/rating`, c.cookie, { stars: 5 })).json().error.code).toBe(
      'NOT_RATEABLE',
    );
    await deliver(r, d.id);
    expect((await call('POST', `/api/deliveries/${d.id}/rating`, stranger.cookie, { stars: 1 })).statusCode).toBe(404);
    expect((await call('POST', `/api/deliveries/${d.id}/rating`, c.cookie, { stars: 6 })).statusCode).toBe(400);
    const first = await call('POST', `/api/deliveries/${d.id}/rating`, c.cookie, { stars: 4, comment: 'Quick' });
    expect(first.statusCode).toBe(201);
    expect((await call('POST', `/api/deliveries/${d.id}/rating`, c.cookie, { stars: 1 })).json().error.code).toBe(
      'ALREADY_RATED',
    );
    expect((await call('GET', `/api/deliveries/${d.id}/rating`, c.cookie)).json()).toMatchObject({ stars: 4 });
    expect((await standing(r)).rating).toEqual({ average: 4, count: 1 });
  });

  it('a rider can report a rating; an admin removal stops it counting', async () => {
    const c = await customer();
    const a = await admin();
    const r = await rider();
    const d = await book(c);
    await claim(r, d.id);
    await deliver(r, d.id);
    await call('POST', `/api/deliveries/${d.id}/rating`, c.cookie, { stars: 1 });
    expect(
      (await call('POST', `/api/rider/ratings/${d.id}/report`, r.cookie, { reason: 'Customer was not home' }))
        .statusCode,
    ).toBe(204);
    const reported = (await call('GET', '/api/admin/ratings?status=reported', a.cookie)).json();
    expect(reported).toHaveLength(1);
    expect(reported[0].flags).toContain('one_star_no_comment');
    expect(
      (await call('POST', `/api/admin/ratings/${d.id}/review`, a.cookie, { decision: 'remove', note: 'Not the rider’s fault' }))
        .statusCode,
    ).toBe(204);
    expect((await standing(r)).rating).toEqual({ average: null, count: 0 });
    const log = await t.database.db.select().from(adminAuditLog).where(eq(adminAuditLog.action, 'rating.remove'));
    expect(log).toHaveLength(1);
    expect((await call('GET', '/api/admin/ratings', r.cookie)).statusCode).toBe(403);
  });
});

// ── Matching ─────────────────────────────────────────────────────────────────

describe('matching', () => {
  it('a brand-new rider with no ratings still gets offers', async () => {
    const fresh = await rider({ online: true });
    const d = await book(await customer());
    const offers = await t.database.db.select().from(deliveryOffers).where(eq(deliveryOffers.deliveryId, d.id));
    expect(offers.map((o) => o.riderId)).toContain(fresh.id);
  });
});

// ── Wallet ───────────────────────────────────────────────────────────────────

describe('commission wallet', () => {
  it('deducts the recorded commission once, only when the job is delivered', async () => {
    const c = await customer();
    const r = await rider();
    const cancelled = await book(c);
    await claim(r, cancelled.id);
    await call('POST', `/api/deliveries/${cancelled.id}/cancel`, c.cookie, {});
    expect((await wallet(r)).balance).toBe('0.00');

    const d = await book(c);
    const commission = (await row(d.id)).commissionAmount;
    expect(Number(commission)).toBeCloseTo(Number(d.fare) * 0.15, 1);
    await claim(r, d.id);
    await deliver(r, d.id);
    await step(r, d.id, 'delivered');
    const w = await wallet(r);
    expect(w.balance).toBe((-Number(commission)).toFixed(2));
    const ledger = await t.database.db.select().from(riderLedger).where(eq(riderLedger.deliveryId, d.id));
    expect(ledger).toHaveLength(1);
  });

  it('bicycles pay 10%', async () => {
    const d = await book(await customer(), 'bicycle');
    const r = await row(d.id);
    expect(Number(r.commissionRate)).toBe(0.1);
  });

  it('a low balance blocks new jobs but never interrupts the active one', async () => {
    const c = await customer();
    const a = await admin();
    const r = await rider();
    const d = await book(c);
    expect((await claim(r, d.id)).statusCode).toBe(200);
    // An admin debit mid-job (counting this job's commission) stays within the −50 limit.
    const debit = await call('POST', `/api/admin/riders/${r.id}/wallet/adjust`, a.cookie, {
      amount: '-20',
      reason: 'Damaged parcel deduction',
    });
    expect(debit.statusCode).toBe(200);
    await deliver(r, d.id);
    const w = await wallet(r);
    expect(Number(w.balance)).toBeGreaterThanOrEqual(-50);
    expect(w.canTakeWork).toBe(false);

    const next = await book(c);
    const refused = await claim(r, next.id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('WALLET_LOW');
    expect((await call('GET', '/api/rider/pool', r.cookie)).json().blockedReason).toBe('wallet');
    // Still allowed to be online.
    expect((await call('POST', '/api/rider/status', r.cookie, { online: true })).statusCode).toBe(200);
  });

  it('never lets a job take the wallet past the −50 ETB ceiling', async () => {
    const c = await customer();
    const a = await admin();
    const r = await rider();
    const d = await book(c);
    const fare = Number((await row(d.id)).fareAmount);
    await t.database.db
      .update(deliveries)
      .set({ commissionAmount: '60.00', riderEarning: (fare - 60).toFixed(2) })
      .where(eq(deliveries.id, d.id));
    expect((await claim(r, d.id)).json().error.code).toBe('WALLET_LOW');
    const tooMuch = await call('POST', `/api/admin/riders/${r.id}/wallet/adjust`, a.cookie, {
      amount: '-51',
      reason: 'Testing the ceiling',
    });
    expect(tooMuch.json().error.code).toBe('OVER_DEBT_LIMIT');
  });

  it('top-ups credit only after admin verification, exactly once; references are unique', async () => {
    const a = await admin();
    const r = await rider();
    const other = await rider();
    const req = await call('POST', '/api/rider/wallet/topups', r.cookie, {
      amount: '200',
      method: 'telebirr',
      reference: 'abc123xyz',
    });
    expect(req.statusCode).toBe(201);
    expect(req.json()).toMatchObject({ status: 'pending', reference: 'ABC123XYZ' });
    expect((await wallet(r)).balance).toBe('0.00');

    const dup = await call('POST', '/api/rider/wallet/topups', other.cookie, {
      amount: '200',
      method: 'telebirr',
      reference: 'ABC123XYZ',
    });
    expect(dup.json().error.code).toBe('DUPLICATE_REFERENCE');
    expect(
      (await call('POST', '/api/rider/wallet/topups', r.cookie, { amount: '200', method: 'cash', reference: 'X1234567' }))
        .statusCode,
    ).toBe(400);

    const id = req.json().id;
    expect((await call('POST', `/api/admin/topups/${id}/review`, r.cookie, { decision: 'verify' })).statusCode).toBe(403);
    const [v1, v2] = await Promise.all([
      call('POST', `/api/admin/topups/${id}/review`, a.cookie, { decision: 'verify' }),
      call('POST', `/api/admin/topups/${id}/review`, a.cookie, { decision: 'verify' }),
    ]);
    expect([v1.statusCode, v2.statusCode].sort()).toEqual([200, 409]);
    expect((await wallet(r)).balance).toBe('200.00');
    const log = await t.database.db.select().from(adminAuditLog).where(eq(adminAuditLog.action, 'wallet.topup_verify'));
    expect(log).toHaveLength(1);

    // A rejected claim credits nothing and frees the reference.
    const bad = await call('POST', '/api/rider/wallet/topups', other.cookie, {
      amount: '50',
      method: 'cbe_birr',
      reference: 'FT2400001',
    });
    await call('POST', `/api/admin/topups/${bad.json().id}/review`, a.cookie, { decision: 'reject', note: 'Not found in statement' });
    expect((await wallet(other)).balance).toBe('0.00');
    const retry = await call('POST', '/api/rider/wallet/topups', other.cookie, {
      amount: '50',
      method: 'cbe_birr',
      reference: 'FT2400001',
    });
    expect(retry.statusCode).toBe(201);
  });

  it('wallet settings are admin-only and audited', async () => {
    const a = await admin();
    const r = await rider();
    expect((await call('PUT', '/api/admin/settings/platform', r.cookie, { walletMinBalance: '0', reason: 'x' })).statusCode).toBe(403);
    const res = await call('PUT', '/api/admin/settings/platform', a.cookie, {
      walletMinBalance: '20',
      reason: 'Riders must keep a small float',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().walletMinBalance).toBe('20.00');
    expect((await wallet(r)).minBalance).toBe('20.00');
    const log = await t.database.db.select().from(adminAuditLog).where(eq(adminAuditLog.action, 'settings.update'));
    expect(log).toHaveLength(1);
  });
});

// ── Route recording and history ──────────────────────────────────────────────

describe('route recording and history', () => {
  const at = (offsetSec: number) => new Date(t.clock.now().getTime() + offsetSec * 1000).toISOString();

  it('stores real fixes once, in order, with stages; rejects bad ones', async () => {
    const c = await customer();
    const r = await rider();
    const d = await book(c);
    await claim(r, d.id);
    const route = (points: unknown[]) => call('POST', `/api/rider/jobs/${d.id}/route`, r.cookie, { points });

    const first = await route([
      { lat: 9.0105, lng: 38.7614, recordedAt: at(10), accuracyM: 8 },
      { lat: 9.012, lng: 38.761, recordedAt: at(70), accuracyM: 10 },
      { lat: 9.0121, lng: 38.761, recordedAt: at(80), accuracyM: 900 }, // too vague
      { lat: 9.3, lng: 38.9, recordedAt: at(90), accuracyM: 5 }, // 30 km in 20 s
      { lat: 9.013, lng: 38.761, recordedAt: at(-3600), accuracyM: 5 }, // before the job
    ]);
    expect(first.json()).toEqual({ accepted: 2, rejected: 3 });
    // An offline batch sent again (plus one new fix) stores only the new one.
    const again = await route([
      { lat: 9.012, lng: 38.761, recordedAt: at(70), accuracyM: 10 },
      { lat: 9.014, lng: 38.76, recordedAt: at(100), accuracyM: 10 },
    ]);
    expect(again.json().accepted).toBe(1);

    t.clock.advanceSeconds(200);
    await step(r, d.id, 'arrived_pickup');
    await step(r, d.id, 'picked_up');
    await route([{ lat: 9.02, lng: 38.758, recordedAt: at(30), accuracyM: 6 }]);
    await step(r, d.id, 'arrived_dropoff');
    await call('POST', `/api/rider/jobs/${d.id}/payment`, r.cookie, { method: 'cash' });
    await step(r, d.id, 'delivered');

    const detail = (await call('GET', `/api/rider/history/${d.id}`, r.cookie)).json();
    expect(detail.route.map((p: { stage: string }) => p.stage)).toEqual([
      'to_pickup',
      'to_pickup',
      'to_pickup',
      'to_dropoff',
    ]);
    const times = detail.route.map((p: { at: string }) => p.at);
    expect([...times].sort()).toEqual(times);
    expect(detail.recordedKm).toBeGreaterThan(0);
    expect(detail.status).toBe('delivered');
    expect(Number(detail.commissionDeducted)).toBeGreaterThan(0);
    expect(detail.timeline.length).toBeGreaterThanOrEqual(5);
  });

  it('a rider can only record and read their own jobs', async () => {
    const c = await customer();
    const owner = await rider();
    const other = await rider();
    const d = await book(c);
    await claim(owner, d.id);
    const res = await call('POST', `/api/rider/jobs/${d.id}/route`, other.cookie, {
      points: [{ lat: 9.01, lng: 38.76, recordedAt: at(5) }],
    });
    expect(res.statusCode).toBe(404);
    expect((await call('GET', `/api/rider/history/${d.id}`, other.cookie)).statusCode).toBe(404);
    expect((await call('GET', '/api/rider/history', other.cookie)).json()).toHaveLength(0);
  });

  it('admins can search history, replay a route (audited) and export', async () => {
    const c = await customer();
    const a = await admin();
    const r = await rider();
    const d = await book(c);
    await claim(r, d.id);
    await call('POST', `/api/rider/jobs/${d.id}/route`, r.cookie, {
      points: [{ lat: 9.0105, lng: 38.7614, recordedAt: at(10), accuracyM: 8 }],
    });
    await deliver(r, d.id);

    const list = (await call('GET', '/api/admin/history?group=completed', a.cookie)).json();
    expect(list.find((x: { id: string }) => x.id === d.id)).toMatchObject({ routePoints: 1, commission: expect.any(String) });
    const byCode = (await call('GET', `/api/admin/history?q=${d.code}`, a.cookie)).json();
    expect(byCode).toHaveLength(1);
    const detail = await call('GET', `/api/admin/deliveries/${d.id}/history`, a.cookie);
    expect(detail.json().route).toHaveLength(1);
    const views = await t.database.db.select().from(adminAuditLog).where(eq(adminAuditLog.action, 'delivery.route_view'));
    expect(views).toHaveLength(1);
    const csv = await call('GET', '/api/admin/history.csv', a.cookie);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain(d.code);

    for (const url of ['/api/admin/history', `/api/admin/deliveries/${d.id}/history`, '/api/admin/history.csv', '/api/admin/wallets', '/api/admin/topups']) {
      expect((await call('GET', url, r.cookie)).statusCode).toBe(403);
      expect((await call('GET', url, c.cookie)).statusCode).toBe(403);
    }
  });
});
