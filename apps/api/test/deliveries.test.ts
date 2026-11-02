// Booking API: quotes, server-side pricing, idempotency, ownership, cancellation rules.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { deliveries, deliveryEvents, riders, users } from '../src/db/schema.ts';
import { createTestApp, ORIGIN, signIn, type TestApp } from './helpers.ts';

let t: TestApp;
let cookie: string;
let userId: string;

beforeEach(async () => {
  t = await createTestApp();
  const s = await signIn(t, '0911234567');
  cookie = s.cookie;
  userId = s.body.user.id;
});
afterEach(() => t.close());

const MESKEL = { lat: 9.0105, lng: 38.7614 };
const PIASSA = { lat: 9.0326, lng: 38.7541 };
const AKAKI = { lat: 8.8711, lng: 38.7864 };

const booking = (over: Record<string, unknown> = {}) => ({
  pickup: {
    ...MESKEL,
    address: 'Meskel Square',
    subCity: 'kirkos',
    contactName: 'Hana',
    contactPhone: '0911234567',
    notes: 'Gate 2',
  },
  dropoff: {
    ...PIASSA,
    address: 'Piassa',
    subCity: 'arada',
    contactName: 'Abel',
    contactPhone: '+251 92 222 2222',
  },
  vehicleType: 'motorcycle',
  payer: 'receiver',
  preferredPaymentMethod: 'telebirr',
  parcel: { description: 'Documents in an envelope', size: 'small' },
  ...over,
});

const req = (
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
  c = cookie,
) =>
  t.app.inject({
    method,
    url,
    headers: { cookie: c, origin: ORIGIN, ...headers },
    ...(payload ? { payload: payload as object } : {}),
  });

const create = (body = booking(), key = 'key-0000001') =>
  req('POST', '/api/deliveries', body, { 'idempotency-key': key });

describe('quote', () => {
  it('prices both vehicles from the current rules', async () => {
    const res = await req('POST', '/api/deliveries/quote', { pickup: MESKEL, dropoff: PIASSA });
    expect(res.statusCode).toBe(200);
    const q = res.json();
    expect(q.distanceSource).toBe('estimate');
    expect(q.options.map((o: { vehicleType: string }) => o.vehicleType)).toEqual([
      'motorcycle',
      'bicycle',
    ]);
    expect(q.options.every((o: { available: boolean }) => o.available)).toBe(true);
  });

  it('marks bicycles unavailable beyond 8 km', async () => {
    const q = (
      await req('POST', '/api/deliveries/quote', { pickup: PIASSA, dropoff: AKAKI })
    ).json();
    const bike = q.options.find((o: { vehicleType: string }) => o.vehicleType === 'bicycle');
    expect(bike.available).toBe(false);
    expect(bike.unavailableReason).toMatch(/8 km/);
  });

  it('rejects locations outside Addis Ababa', async () => {
    const res = await req('POST', '/api/deliveries/quote', {
      pickup: { lat: 8.54, lng: 39.27 },
      dropoff: PIASSA,
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires a signed-in customer', async () => {
    const res = await req(
      'POST',
      '/api/deliveries/quote',
      { pickup: MESKEL, dropoff: PIASSA },
      {},
      '',
    );
    expect(res.statusCode).toBe(401);
  });
});

describe('create', () => {
  it('books with server-computed pricing and records the first event', async () => {
    const res = await create();
    expect(res.statusCode).toBe(201);
    const d = res.json();
    expect(d).toMatchObject({
      status: 'requested',
      payer: 'receiver',
      fare: expect.stringMatching(/^\d+\.00$/),
      cancelFeeNow: '0.00',
      rider: null,
    });
    expect(d.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(d.dropoff.contactPhone).toBe('+251922222222');
    expect(d.events).toHaveLength(1);
    expect(d.events[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'requested',
      actorRole: 'customer',
    });

    const [row] = await t.database.db.select().from(deliveries);
    expect(Number(row!.commissionAmount) + Number(row!.riderEarning)).toBeCloseTo(
      Number(row!.fareAmount),
      2,
    );
    expect(row!.commissionRate).toBe('0.1500');
  });

  it('ignores any price the client tries to send', async () => {
    const res = await create(booking({ fare: '1.00', fareAmount: '1.00' }));
    expect(res.statusCode).toBe(201);
    expect(Number(res.json().fare)).toBeGreaterThanOrEqual(80);
  });

  it('a repeated request with the same idempotency key returns the same booking', async () => {
    const first = await create();
    const again = await create();
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(first.json().id);
    const parallel = await Promise.all([
      create(booking(), 'key-par-01'),
      create(booking(), 'key-par-01'),
    ]);
    expect(new Set(parallel.map((r) => r.json().id)).size).toBe(1);
    expect(await t.database.db.select().from(deliveries)).toHaveLength(2);
  });

  it('requires an idempotency key', async () => {
    const res = await req('POST', '/api/deliveries', booking());
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('rejects bicycles over the distance limit', async () => {
    const res = await create(
      booking({ vehicleType: 'bicycle', dropoff: { ...booking().dropoff, ...AKAKI } }),
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VEHICLE_UNAVAILABLE');
  });

  it('validates contacts and parcel details', async () => {
    const res = await create(
      booking({
        dropoff: { ...booking().dropoff, contactPhone: '011 123 4567' },
        parcel: { description: '', size: 'huge' },
      }),
    );
    expect(res.statusCode).toBe(400);
    const fields = Object.keys(res.json().error.fields);
    expect(fields).toEqual(
      expect.arrayContaining(['dropoff.contactPhone', 'parcel.description', 'parcel.size']),
    );
  });

  it('riders can also book (same phone, both apps); admins cannot', async () => {
    await t.database.db.update(users).set({ role: 'rider' }).where(eq(users.id, userId));
    expect((await create(booking(), 'key-rider-0001')).statusCode).toBe(201);
    await t.database.db.update(users).set({ role: 'admin' }).where(eq(users.id, userId));
    expect((await create(booking(), 'key-admin-0001')).statusCode).toBe(403);
  });
});

describe('read', () => {
  it('lists only my deliveries, newest first', async () => {
    await create(booking(), 'key-a-0001');
    t.clock.advanceSeconds(60);
    await create(booking({ vehicleType: 'bicycle' }), 'key-b-0001');
    t.clock.advanceSeconds(3600);
    const other = await signIn(t, '0933333333');
    await req(
      'POST',
      '/api/deliveries',
      booking(),
      { 'idempotency-key': 'key-c-0001' },
      other.cookie,
    );

    const mine = (await req('GET', '/api/deliveries')).json();
    expect(mine.map((d: { vehicleType: string }) => d.vehicleType)).toEqual([
      'bicycle',
      'motorcycle',
    ]);
  });

  it("another customer's delivery is a 404, not a 403", async () => {
    const d = (await create()).json();
    t.clock.advanceSeconds(3600);
    const other = await signIn(t, '0933333333');
    expect(
      (await req('GET', `/api/deliveries/${d.id}`, undefined, {}, other.cookie)).statusCode,
    ).toBe(404);
    expect((await req('GET', '/api/deliveries/not-a-uuid')).statusCode).toBe(404);
  });
});

describe('cancel', () => {
  async function riderUser(phone = '+251944444444') {
    const [u] = await t.database.db
      .insert(users)
      .values({ phoneE164: phone, role: 'rider' })
      .returning();
    await t.database.db.insert(riders).values({
      userId: u!.id,
      vehicleType: 'motorcycle',
      plateNumber: '3-A12345',
      approvalStatus: 'approved',
      kycStatus: 'approved',
    });
    return u!.id;
  }

  it('is free before the rider arrives', async () => {
    const d = (await create()).json();
    const res = await req('POST', `/api/deliveries/${d.id}/cancel`, { reason: 'Changed my mind' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'cancelled',
      cancellationFee: '0.00',
      cancelFeeNow: null,
    });
    const events = await t.database.db
      .select()
      .from(deliveryEvents)
      .where(eq(deliveryEvents.deliveryId, d.id));
    expect(events.map((e) => e.toStatus)).toEqual(['requested', 'cancelled']);
  });

  it('charges the motorcycle fee (40 ETB) after the rider has arrived', async () => {
    const d = (await create()).json();
    const rider = await riderUser();
    await t.database.db
      .update(deliveries)
      .set({ riderId: rider, status: 'arrived_pickup' })
      .where(eq(deliveries.id, d.id));
    const view = (await req('GET', `/api/deliveries/${d.id}`)).json();
    expect(view.cancelFeeNow).toBe('40.00');
    expect(view.rider).toMatchObject({ plate: '3-A12345', vehicleType: 'motorcycle' });
    const res = await req('POST', `/api/deliveries/${d.id}/cancel`, {});
    expect(res.json()).toMatchObject({ status: 'cancelled', cancellationFee: '40.00' });
  });

  it('cannot cancel once picked up, or twice', async () => {
    const d = (await create()).json();
    const rider = await riderUser();
    await t.database.db
      .update(deliveries)
      .set({ riderId: rider, status: 'picked_up' })
      .where(eq(deliveries.id, d.id));
    expect((await req('POST', `/api/deliveries/${d.id}/cancel`, {})).statusCode).toBe(409);

    const d2 = (await create(booking(), 'key-0000002')).json();
    expect((await req('POST', `/api/deliveries/${d2.id}/cancel`, {})).statusCode).toBe(200);
    expect((await req('POST', `/api/deliveries/${d2.id}/cancel`, {})).statusCode).toBe(409);
  });
});

describe('database rules', () => {
  it('a rider can hold only one active delivery', async () => {
    const [u] = await t.database.db
      .insert(users)
      .values({ phoneE164: '+251955555555', role: 'rider' })
      .returning();
    await t.database.db
      .insert(riders)
      .values({ userId: u!.id, vehicleType: 'bicycle', approvalStatus: 'approved', kycStatus: 'approved' });
    const a = (await create(booking(), 'key-x-0001')).json();
    const b = (await create(booking(), 'key-y-0001')).json();
    await t.database.db
      .update(deliveries)
      .set({ riderId: u!.id, status: 'assigned' })
      .where(eq(deliveries.id, a.id));
    await expect(
      t.database.db
        .update(deliveries)
        .set({ riderId: u!.id, status: 'assigned' })
        .where(eq(deliveries.id, b.id)),
    ).rejects.toThrow();
    // Once the first is delivered, the rider is free again.
    await t.database.db
      .update(deliveries)
      .set({ status: 'delivered' })
      .where(eq(deliveries.id, a.id));
    await t.database.db
      .update(deliveries)
      .set({ riderId: u!.id, status: 'assigned' })
      .where(eq(deliveries.id, b.id));
  });

  it('an active delivery must have a rider, and the money split must add up', async () => {
    const d = (await create()).json();
    await expect(
      t.database.db.update(deliveries).set({ status: 'assigned' }).where(eq(deliveries.id, d.id)),
    ).rejects.toThrow();
    await expect(
      t.database.db.update(deliveries).set({ riderEarning: '1.00' }).where(eq(deliveries.id, d.id)),
    ).rejects.toThrow();
  });

  it('motorcycle riders need a plate number', async () => {
    const [u] = await t.database.db
      .insert(users)
      .values({ phoneE164: '+251966666666', role: 'rider' })
      .returning();
    await expect(
      t.database.db.insert(riders).values({ userId: u!.id, vehicleType: 'motorcycle' }),
    ).rejects.toThrow();
  });
});

describe('geo proxy', () => {
  it('suggests, resolves and reverse-geocodes for signed-in users only', async () => {
    const found = (await req('GET', '/api/geo/search?q=piassa')).json();
    expect(found[0]).toMatchObject({ name: 'Piassa', subCity: 'arada', ref: 'fake:Piassa' });
    const place = (
      await req('GET', `/api/geo/resolve?ref=${encodeURIComponent(found[0].ref)}`)
    ).json();
    expect(place).toMatchObject({ name: 'Piassa', lat: 9.0326, lng: 38.7541, inServiceArea: true });
    const rev = (await req('GET', '/api/geo/reverse?lat=9.011&lng=38.762')).json();
    expect(rev).toMatchObject({ subCity: 'kirkos', lat: 9.011, lng: 38.762 });
    expect((await req('GET', '/api/geo/search?q=piassa', undefined, {}, '')).statusCode).toBe(401);
  });
});
