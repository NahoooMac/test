// Scooter as a third vehicle (priced like a bicycle at launch), and the anonymous nearby-riders
// feed for the customer's booking map.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { deliveryOffers, pricingRules, riders, users } from '../src/db/schema.ts';
import { createTestApp, ORIGIN, signIn, type TestApp } from './helpers.ts';

let t: TestApp;
let n = 0;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const MESKEL = { lat: 9.0105, lng: 38.7614 };
const PIASSA = { lat: 9.0326, lng: 38.7541 };

const call = (method: 'GET' | 'POST', url: string, cookie: string, payload?: unknown, headers: Record<string, string> = {}) =>
  t.app.inject({ method, url, headers: { cookie, origin: ORIGIN, ...headers }, ...(payload ? { payload: payload as object } : {}) });

async function customer() {
  const s = await signIn(t, `09130${String(++n).padStart(5, '0')}`, `10.90.0.${n}`);
  return { id: s.body.user.id as string, cookie: s.cookie };
}
async function rider(vehicle: 'motorcycle' | 'bicycle' | 'scooter', at = MESKEL, opts: { online?: boolean } = {}) {
  const s = await signIn(t, `09460${String(++n).padStart(5, '0')}`, `10.90.1.${n}`);
  const apply = await call('POST', '/api/rider/apply', s.cookie, {
    fullName: 'Near Rider',
    vehicleType: vehicle,
    ...(vehicle === 'bicycle' ? {} : { plateNumber: `3-S${n}` }),
  });
  expect(apply.statusCode).toBe(201);
  await t.database.db
    .update(riders)
    .set({ approvalStatus: 'approved', kycStatus: 'approved' })
    .where(eq(riders.userId, s.body.user.id));
  if (opts.online !== false) {
    await call('POST', '/api/rider/status', s.cookie, { online: true });
    await call('POST', '/api/rider/location', s.cookie, at);
  }
  return { id: s.body.user.id as string, cookie: s.cookie };
}

describe('scooter', () => {
  it('is offered in the quote, priced like the bicycle rule it was copied from', async () => {
    const c = await customer();
    const q = (await call('POST', '/api/deliveries/quote', c.cookie, { pickup: MESKEL, dropoff: PIASSA })).json();
    const by = Object.fromEntries(q.options.map((o: { vehicleType: string }) => [o.vehicleType, o]));
    expect(Object.keys(by).sort()).toEqual(['bicycle', 'motorcycle', 'scooter']);
    expect(by.scooter.available).toBe(true);
    expect(by.scooter.fare).toBe(by.bicycle.fare);
    expect(by.scooter.cancellationFeeAfterArrival).toBe(by.bicycle.cancellationFeeAfterArrival);
    const [bike] = await t.database.db.select().from(pricingRules).where(and(eq(pricingRules.vehicleType, 'bicycle'), isNull(pricingRules.effectiveTo)));
    const [scooter] = await t.database.db.select().from(pricingRules).where(and(eq(pricingRules.vehicleType, 'scooter'), isNull(pricingRules.effectiveTo)));
    expect(scooter).toMatchObject({ commissionRate: bike!.commissionRate, maxDistanceKm: bike!.maxDistanceKm });
  });

  it('needs a plate to apply, and scooter jobs go to scooter riders', async () => {
    const s = await signIn(t, '0946099999', '10.90.2.1');
    const noPlate = await call('POST', '/api/rider/apply', s.cookie, { fullName: 'No Plate', vehicleType: 'scooter' });
    expect(noPlate.statusCode).toBe(400);
    await rider('motorcycle');
    const scooterRider = await rider('scooter');
    const c = await customer();
    const res = await call(
      'POST',
      '/api/deliveries',
      c.cookie,
      {
        pickup: { ...MESKEL, address: 'Meskel Square', contactName: 'Hana', contactPhone: '0911111111' },
        dropoff: { ...PIASSA, address: 'Piassa', contactName: 'Abel', contactPhone: '0922222222' },
        vehicleType: 'scooter',
        payer: 'sender',
        preferredPaymentMethod: 'cash',
        parcel: { description: 'Docs', size: 'small' },
      },
      { 'idempotency-key': 'scooter-key-1' },
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().vehicleType).toBe('scooter');
    const offers = await t.database.db.select().from(deliveryOffers).where(eq(deliveryOffers.deliveryId, res.json().id));
    expect(offers.map((o) => o.riderId)).toEqual([scooterRider.id]);
  });
});

describe('nearby riders', () => {
  const near = (cookie: string, at = MESKEL) => call('GET', `/api/geo/nearby-riders?lat=${at.lat}&lng=${at.lng}`, cookie);

  it('shows free riders within 3 km as approximate, anonymous points with their vehicle', async () => {
    const r1 = await rider('motorcycle', { lat: 9.012, lng: 38.762 });
    await rider('scooter', { lat: 9.015, lng: 38.758 });
    await rider('bicycle', { lat: 9.2, lng: 38.9 }); // ~25 km away
    await rider('motorcycle', MESKEL, { online: false }); // offline
    const c = await customer();
    const res = await near(c.cookie);
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<Record<string, unknown>>;
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.vehicleType).sort()).toEqual(['motorcycle', 'scooter']);
    for (const r of list) {
      expect(Object.keys(r).sort()).toEqual(['heading', 'key', 'lat', 'lng', 'vehicleType']);
      expect(r.key).not.toContain(r1.id.slice(0, 8));
    }
    // The real position is never returned exactly (shifted up to ~120 m and rounded).
    expect(JSON.stringify(list)).not.toContain('9.012,');
    expect(res.body).not.toContain(r1.id);
  });

  it('leaves out busy riders and stale locations', async () => {
    const busy = await rider('motorcycle');
    const stale = await rider('scooter');
    const c = await customer();
    const res = await call(
      'POST',
      '/api/deliveries',
      c.cookie,
      {
        pickup: { ...MESKEL, address: 'Meskel Square', contactName: 'Hana', contactPhone: '0911111111' },
        dropoff: { ...PIASSA, address: 'Piassa', contactName: 'Abel', contactPhone: '0922222222' },
        vehicleType: 'motorcycle',
        payer: 'sender',
        preferredPaymentMethod: 'cash',
        parcel: { description: 'Docs', size: 'small' },
      },
      { 'idempotency-key': 'near-key-1' },
    );
    const [offer] = await t.database.db.select().from(deliveryOffers).where(eq(deliveryOffers.deliveryId, res.json().id));
    expect((await call('POST', `/api/rider/offers/${offer!.id}/accept`, busy.cookie)).statusCode).toBe(200);
    await t.database.db.update(riders).set({ locationUpdatedAt: new Date(t.clock.now().getTime() - 10 * 60_000) }).where(eq(riders.userId, stale.id));
    expect((await near(c.cookie)).json()).toHaveLength(0);
  });

  it('needs a signed-in customer and valid coordinates', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/geo/nearby-riders?lat=9&lng=38' })).statusCode).toBe(401);
    const s = await signIn(t, '0955099999', '10.90.3.1');
    await t.database.db.update(users).set({ role: 'admin' }).where(eq(users.id, s.body.user.id));
    expect((await near(s.cookie)).statusCode).toBe(403);
    const c = await customer();
    expect((await call('GET', '/api/geo/nearby-riders?lat=abc&lng=38', c.cookie)).statusCode).toBe(400);
  });
});
