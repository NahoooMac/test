// Rider onboarding, dispatch, offers, assignment races, job steps and the failed-delivery rule.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { deliveries, deliveryOffers, riders, users } from '../src/db/schema.ts';
import { createTestApp, ORIGIN, signIn, submitKyc, type TestApp } from './helpers.ts';

let t: TestApp;
let ipCounter = 0;
const nextIp = () => `10.20.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const MESKEL = { lat: 9.0105, lng: 38.7614 };
const PIASSA = { lat: 9.0326, lng: 38.7541 };
const near = (km: number) => ({ lat: MESKEL.lat + km / 111.32, lng: MESKEL.lng });

const call = (
  method: 'GET' | 'POST',
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

async function customer(phone = '0911111111') {
  const s = await signIn(t, phone, nextIp());
  return { id: s.body.user.id as string, cookie: s.cookie };
}

async function rider(
  phone: string,
  opts: {
    vehicle?: 'motorcycle' | 'bicycle';
    at?: { lat: number; lng: number };
    online?: boolean;
  } = {},
) {
  const s = await signIn(t, phone, nextIp());
  const vehicle = opts.vehicle ?? 'motorcycle';
  const apply = await call('POST', '/api/rider/apply', s.cookie, {
    fullName: `Rider ${phone.slice(-3)}`,
    vehicleType: vehicle,
    plateNumber: vehicle === 'motorcycle' ? `3-A${phone.slice(-5)}` : undefined,
  });
  expect(apply.statusCode).toBe(201);
  const id = s.body.user.id as string;
  await t.database.db
    .update(riders)
    .set({ approvalStatus: 'approved', kycStatus: 'approved' })
    .where(eq(riders.userId, id));
  if (opts.online !== false) {
    expect((await call('POST', '/api/rider/status', s.cookie, { online: true })).statusCode).toBe(
      200,
    );
    const at = opts.at ?? MESKEL;
    expect((await call('POST', '/api/rider/location', s.cookie, at)).statusCode).toBe(204);
  }
  return { id, cookie: s.cookie };
}

let keyN = 0;
async function book(c: { cookie: string }, vehicle: 'motorcycle' | 'bicycle' = 'motorcycle') {
  const res = await call(
    'POST',
    '/api/deliveries',
    c.cookie,
    {
      pickup: {
        ...MESKEL,
        address: 'Meskel Square',
        contactName: 'Hana',
        contactPhone: '0911111111',
      },
      dropoff: { ...PIASSA, address: 'Piassa', contactName: 'Abel', contactPhone: '0922222222' },
      vehicleType: vehicle,
      payer: 'sender',
      preferredPaymentMethod: 'cash',
      parcel: { description: 'Documents', size: 'small' },
    },
    { 'idempotency-key': `dispatch-key-${++keyN}` },
  );
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

const home = async (r: { cookie: string }) =>
  (await call('GET', '/api/rider/home', r.cookie)).json();
const openOffers = () =>
  t.database.db.select().from(deliveryOffers).where(eq(deliveryOffers.status, 'offered'));

describe('rider onboarding', () => {
  it('apply → pending → identity verified by admin → can go online', async () => {
    const s = await signIn(t, '0944000001', nextIp());
    const res = await call('POST', '/api/rider/apply', s.cookie, {
      fullName: 'Kebede Alemu',
      vehicleType: 'bicycle',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      approvalStatus: 'pending',
      vehicleType: 'bicycle',
      fullName: 'Kebede Alemu',
    });
    expect((await call('POST', '/api/rider/status', s.cookie, { online: true })).statusCode).toBe(
      403,
    );
    expect((await call('POST', '/api/rider/location', s.cookie, MESKEL)).statusCode).toBe(403);

    const adminS = await signIn(t, '0955000001', nextIp());
    await t.database.db
      .update(users)
      .set({ role: 'admin' })
      .where(eq(users.id, adminS.body.user.id));
    const pending = (await call('GET', '/api/admin/riders?status=pending', adminS.cookie)).json();
    expect(pending.map((r: { fullName: string }) => r.fullName)).toEqual(['Kebede Alemu']);
    // Approving the account directly is refused until identity is verified.
    const early = await call('POST', `/api/admin/riders/${s.body.user.id}/decision`, adminS.cookie, {
      decision: 'approve',
    });
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('KYC_REQUIRED');

    await submitKyc(t, s.cookie);
    const decide = await call(
      'POST',
      `/api/admin/riders/${s.body.user.id}/kyc/decision`,
      adminS.cookie,
      { decision: 'approve' },
    );
    expect(decide.statusCode).toBe(204);
    expect(
      (await call('POST', '/api/rider/status', s.cookie, { online: true })).json().isOnline,
    ).toBe(true);
  });

  it('motorcycles need a plate', async () => {
    const s = await signIn(t, '0944000002', nextIp());
    const noPlate = await call('POST', '/api/rider/apply', s.cookie, {
      fullName: 'Sara T',
      vehicleType: 'motorcycle',
    });
    expect(noPlate.statusCode).toBe(400);
    expect(noPlate.json().error.fields.plateNumber).toBeDefined();
  });

  it('a customer can become a rider with the same phone and still send parcels', async () => {
    const c = await customer('0911000003');
    const before = await book(c);
    const res = await call('POST', '/api/rider/apply', c.cookie, {
      fullName: 'Hana B',
      vehicleType: 'motorcycle',
      plateNumber: '3-A12345',
    });
    expect(res.statusCode).toBe(201);
    await t.database.db.update(riders).set({ approvalStatus: 'approved', kycStatus: 'approved' }).where(eq(riders.userId, c.id));

    // Customer side keeps working for the same session.
    expect((await call('GET', '/api/deliveries', c.cookie)).statusCode).toBe(200);
    const mine = await book(c);
    expect(mine).not.toBe(before);

    // Online at the pickup, the rider is still never offered their own bookings.
    await call('POST', '/api/rider/status', c.cookie, { online: true });
    await call('POST', '/api/rider/location', c.cookie, MESKEL);
    await t.dispatcher.dispatch(mine);
    expect((await openOffers()).filter((o) => o.riderId === c.id)).toHaveLength(0);
  });

  it('admin rules: reject and suspend need a reason; only admins decide', async () => {
    const r = await rider('0944000004', { online: false });
    await t.database.db
      .update(riders)
      .set({ approvalStatus: 'pending' })
      .where(eq(riders.userId, r.id));
    const adminS = await signIn(t, '0955000002', nextIp());
    await t.database.db
      .update(users)
      .set({ role: 'admin' })
      .where(eq(users.id, adminS.body.user.id));
    expect(
      (
        await call('POST', `/api/admin/riders/${r.id}/decision`, adminS.cookie, {
          decision: 'reject',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await call('POST', `/api/admin/riders/${r.id}/decision`, r.cookie, { decision: 'approve' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call('POST', `/api/admin/riders/${r.id}/decision`, adminS.cookie, {
          decision: 'suspend',
          reason: 'x',
        })
      ).statusCode,
    ).toBe(409);
  });
});

describe('dispatch', () => {
  it('offers the job to the nearest eligible rider only', async () => {
    await rider('0944000010', { at: near(0.2), online: true }); // nearest — but goes offline below
    const bike = await rider('0944000011', { vehicle: 'bicycle', at: near(0.3) }); // wrong vehicle
    const stale = await rider('0944000012', { at: near(0.4) }); // location too old
    const mid = await rider('0944000013', { at: near(1.5) });
    await rider('0944000014', { at: near(3.0) });
    const far = await rider('0944000015', { at: near(9.0) }); // beyond 7 km

    await t.database.db
      .update(riders)
      .set({ isOnline: false })
      .where(
        eq(
          riders.userId,
          (await t.database.db.select().from(users).where(eq(users.phoneE164, '+251944000010')))[0]!
            .id,
        ),
      );
    await t.database.db
      .update(riders)
      .set({ locationUpdatedAt: new Date(t.clock.now().getTime() - 10 * 60_000) })
      .where(eq(riders.userId, stale.id));

    await book(await customer());
    const offers = await openOffers();
    expect(offers).toHaveLength(1);
    expect(offers[0]!.riderId).toBe(mid.id);
    expect(offers[0]!.toPickupKm).toBeCloseTo(1.5, 1);
    expect((await home(bike)).offer).toBeNull();
    expect((await home(far)).offer).toBeNull();

    const offer = (await home(mid)).offer;
    expect(offer).toMatchObject({
      secondsLeft: 20,
      delivery: { pickup: { address: 'Meskel Square' }, riderEarning: expect.any(String) },
    });
    // Contact details are not shared before accepting.
    expect(JSON.stringify(offer)).not.toContain('+251922222222');
  });

  it('stays requested when no rider is available, and dispatches once one comes online', async () => {
    const id = await book(await customer());
    expect(await openOffers()).toHaveLength(0);
    const r = await rider('0944000020');
    await t.dispatcher.tick();
    const [offer] = await openOffers();
    expect(offer).toMatchObject({ deliveryId: id, riderId: r.id });
  });

  it('decline and expiry move the offer to the next rider, never back to the same one', async () => {
    const a = await rider('0944000030', { at: near(0.5) });
    const b = await rider('0944000031', { at: near(1.0) });
    const c = await rider('0944000032', { at: near(2.0) });
    await book(await customer());

    const offerA = (await home(a)).offer;
    expect(
      (await call('POST', `/api/rider/offers/${offerA.id}/decline`, a.cookie)).statusCode,
    ).toBe(204);
    await t.dispatcher.tick();
    expect((await home(b)).offer).not.toBeNull();

    t.clock.advanceSeconds(21);
    await call('POST', '/api/rider/location', b.cookie, near(1.0));
    await call('POST', '/api/rider/location', c.cookie, near(2.0));
    await call('POST', '/api/rider/location', a.cookie, near(0.5));
    const tick = await t.dispatcher.tick();
    expect(tick).toEqual({ expired: 1, offered: 1 });
    expect((await home(c)).offer).not.toBeNull();
    expect((await home(a)).offer).toBeNull(); // declined earlier: not asked again
  });

  it('a lapsed offer cannot be accepted', async () => {
    const r = await rider('0944000040');
    await book(await customer());
    const offer = (await home(r)).offer;
    t.clock.advanceSeconds(25);
    const res = await call('POST', `/api/rider/offers/${offer.id}/accept`, r.cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('OFFER_GONE');
  });

  it('one rider is never offered two jobs at once, even when dispatches overlap', async () => {
    const r = await rider('0944000050');
    const c = await customer();
    const [d1, d2] = [await book(c), await book(c)];
    await Promise.all([t.dispatcher.dispatch(d1), t.dispatcher.dispatch(d2), t.dispatcher.tick()]);
    const offers = await openOffers();
    expect(offers.filter((o) => o.riderId === r.id)).toHaveLength(1);
  });
});

describe('accepting', () => {
  it('assigns the delivery and shares contacts with the rider and the rider with the customer', async () => {
    const r = await rider('0944000060');
    const c = await customer();
    const id = await book(c);
    const offer = (await home(r)).offer;
    const res = await call('POST', `/api/rider/offers/${offer.id}/accept`, r.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id,
      status: 'assigned',
      dropoff: { contactPhone: '+251922222222' },
    });

    const view = (await call('GET', `/api/deliveries/${id}`, c.cookie)).json();
    expect(view).toMatchObject({
      status: 'assigned',
      rider: { phone: '+251944000060', plate: '3-A00060' },
    });
    expect(view.events.map((e: { toStatus: string }) => e.toStatus)).toEqual([
      'requested',
      'assigned',
    ]);
    expect((await home(r)).job.id).toBe(id);
  });

  it('double-tapped accept succeeds once', async () => {
    const r = await rider('0944000070');
    await book(await customer());
    const offer = (await home(r)).offer;
    const results = await Promise.all([
      call('POST', `/api/rider/offers/${offer.id}/accept`, r.cookie),
      call('POST', `/api/rider/offers/${offer.id}/accept`, r.cookie),
    ]);
    expect(results.map((x) => x.statusCode).sort()).toEqual([200, 409]);
  });

  it('a busy rider cannot take a second job even if an offer slips through', async () => {
    const r = await rider('0944000080');
    const c = await customer();
    await book(c);
    const first = (await home(r)).offer;
    await call('POST', `/api/rider/offers/${first.id}/accept`, r.cookie);
    // Force a second offer past the dispatcher's own checks.
    const d2 = await book(c);
    const [forced] = await t.database.db
      .insert(deliveryOffers)
      .values({
        deliveryId: d2,
        riderId: r.id,
        toPickupKm: 1,
        expiresAt: new Date(t.clock.now().getTime() + 20_000),
      })
      .returning();
    const res = await call('POST', `/api/rider/offers/${forced!.id}/accept`, r.cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('RIDER_BUSY');
    const [d] = await t.database.db.select().from(deliveries).where(eq(deliveries.id, d2));
    expect(d!.status).toBe('requested');
  });

  it('a customer cancellation withdraws the open offer', async () => {
    const r = await rider('0944000090');
    const c = await customer();
    const id = await book(c);
    const offer = (await home(r)).offer;
    await call('POST', `/api/deliveries/${id}/cancel`, c.cookie, {});
    expect((await home(r)).offer).toBeNull();
    expect((await call('POST', `/api/rider/offers/${offer.id}/accept`, r.cookie)).statusCode).toBe(
      409,
    );
  });
});

describe('job steps', () => {
  async function assigned() {
    const r = await rider(`09440001${String(++keyN).padStart(2, '0')}`);
    const c = await customer(`09110001${String(keyN).padStart(2, '0')}`);
    const id = await book(c);
    const offer = (await home(r)).offer;
    await call('POST', `/api/rider/offers/${offer.id}/accept`, r.cookie);
    const step = (to: string) => call('POST', `/api/rider/jobs/${id}/step`, r.cookie, { to });
    return { r, c, id, step };
  }

  it('runs pickup to delivery in order and frees the rider', async () => {
    const { r, c, id, step } = await assigned();
    expect((await step('picked_up')).statusCode).toBe(409); // cannot skip arrival
    for (const s of ['arrived_pickup', 'picked_up', 'arrived_dropoff']) {
      const res = await step(s);
      expect(res.statusCode, s).toBe(200);
    }
    // The fare must be recorded before the job can be completed.
    expect((await step('delivered')).json().error.code).toBe('PAYMENT_REQUIRED');
    const paid = await call('POST', `/api/rider/jobs/${id}/payment`, r.cookie, { method: 'cash' });
    expect(paid.statusCode).toBe(200);
    expect((await step('delivered')).statusCode).toBe(200);
    const view = (await call('GET', `/api/deliveries/${id}`, c.cookie)).json();
    expect(view.status).toBe('delivered');
    expect(view.events.map((e: { toStatus: string }) => e.toStatus)).toEqual([
      'requested',
      'assigned',
      'arrived_pickup',
      'picked_up',
      'arrived_dropoff',
      'delivered',
    ]);
    expect((await home(r)).job).toBeNull();
    // A retried "Done" is harmless: it reports the finished job instead of failing.
    const again = await step('delivered');
    expect(again.statusCode).toBe(200);
    expect(again.json().status).toBe('delivered');
  });

  it("another rider cannot touch someone else's job", async () => {
    const { id } = await assigned();
    const other = await rider('0944000199');
    expect(
      (await call('POST', `/api/rider/jobs/${id}/step`, other.cookie, { to: 'arrived_pickup' }))
        .statusCode,
    ).toBe(404);
  });

  it('customer cancelling after arrival pays the fee and frees the rider', async () => {
    const { r, c, id, step } = await assigned();
    await step('arrived_pickup');
    const res = await call('POST', `/api/deliveries/${id}/cancel`, c.cookie, {});
    expect(res.json()).toMatchObject({ status: 'cancelled', cancellationFee: '40.00' });
    expect((await home(r)).job).toBeNull();
  });

  it('released jobs go back to dispatch, to someone else', async () => {
    const { r, id } = await assigned();
    const other = await rider('0944000198', { at: near(1) });
    expect((await call('POST', `/api/rider/jobs/${id}/release`, r.cookie)).statusCode).toBe(200);
    await t.dispatcher.tick();
    expect((await home(other)).offer?.delivery.code).toBeDefined();
    expect((await home(r)).offer).toBeNull();
  });
});

describe('failed delivery', () => {
  it('needs 3 unanswered calls over 10 minutes, then returns to sender; fare stays due', async () => {
    const r = await rider('0944000300');
    const c = await customer('0911000300');
    const id = await book(c);
    const offer = (await home(r)).offer;
    await call('POST', `/api/rider/offers/${offer.id}/accept`, r.cookie);
    for (const s of ['arrived_pickup', 'picked_up', 'arrived_dropoff']) {
      await call('POST', `/api/rider/jobs/${id}/step`, r.cookie, { to: s });
    }
    const fail = () => call('POST', `/api/rider/jobs/${id}/fail`, r.cookie);
    const attempt = (outcome = 'no_answer') =>
      call('POST', `/api/rider/jobs/${id}/contact-attempts`, r.cookie, { outcome });

    expect((await fail()).json().error.code).toBe('FAIL_RULE_NOT_MET');
    await attempt();
    t.clock.advanceSeconds(120);
    await attempt('busy');
    t.clock.advanceSeconds(120);
    await attempt('answered'); // answered calls do not count
    t.clock.advanceSeconds(60);
    const third = (await attempt()).json();
    expect(third.contactAttempts).toHaveLength(4);
    const early = await fail();
    expect(early.statusCode).toBe(409);
    expect(early.json().error.details.attempts).toBe(3);

    t.clock.advanceSeconds(6 * 60); // first unanswered call was 11 minutes ago
    const failed = await fail();
    expect(failed.statusCode).toBe(200);
    expect(failed.json().status).toBe('returning');

    // Still busy while bringing the parcel back: no new jobs.
    await book(await customer('0911000301'));
    expect((await home(r)).offer).toBeNull();

    expect(
      (await call('POST', `/api/rider/jobs/${id}/step`, r.cookie, { to: 'returned' })).statusCode,
    ).toBe(200);
    const view = (await call('GET', `/api/deliveries/${id}`, c.cookie)).json();
    expect(view.status).toBe('returned');
    expect(view.events.map((e: { toStatus: string }) => e.toStatus).slice(-3)).toEqual([
      'failed',
      'returning',
      'returned',
    ]);
    const [row] = await t.database.db.select().from(deliveries).where(eq(deliveries.id, id));
    expect(row!.fareAmount).toBe(view.fare);
    expect(row!.cancellationFee).toBe('0.00');
  });

  it('calls can only be logged at the drop-off', async () => {
    const r = await rider('0944000310');
    const id = await book(await customer('0911000310'));
    const offer = (await home(r)).offer;
    await call('POST', `/api/rider/offers/${offer.id}/accept`, r.cookie);
    const res = await call('POST', `/api/rider/jobs/${id}/contact-attempts`, r.cookie, {
      outcome: 'no_answer',
    });
    expect(res.statusCode).toBe(409);
  });
});
