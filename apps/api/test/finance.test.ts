// Payments, commission ledger, settlements, pricing versions and admin tools.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  adminAuditLog,
  deliveries,
  payments,
  pricingRules,
  riderLedger,
  riders,
  users,
} from '../src/db/schema.ts';
import { createTestApp, ORIGIN, signIn, type TestApp } from './helpers.ts';

let t: TestApp;
let ip = 0;
const nextIp = () => `10.40.${Math.floor(++ip / 250)}.${ip % 250}`;

beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const MESKEL = { lat: 9.0105, lng: 38.7614 };
const PIASSA = { lat: 9.0326, lng: 38.7541 };

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

let phoneN = 0;
const phone = (prefix: string) => `${prefix}${String(++phoneN).padStart(4, '0')}`;

async function customer() {
  const s = await signIn(t, phone('091100'), nextIp());
  return { id: s.body.user.id as string, cookie: s.cookie };
}
async function admin() {
  const s = await signIn(t, phone('095500'), nextIp());
  await t.database.db.update(users).set({ role: 'admin' }).where(eq(users.id, s.body.user.id));
  return { id: s.body.user.id as string, cookie: s.cookie };
}
async function rider(opts: { vehicle?: 'motorcycle' | 'bicycle'; online?: boolean } = {}) {
  const s = await signIn(t, phone('094400'), nextIp());
  const vehicle = opts.vehicle ?? 'motorcycle';
  await call('POST', '/api/rider/apply', s.cookie, {
    fullName: 'Test Rider',
    vehicleType: vehicle,
    plateNumber: vehicle === 'motorcycle' ? `3-A${phoneN}` : undefined,
  });
  await t.database.db
    .update(riders)
    .set({ approvalStatus: 'approved', kycStatus: 'approved' })
    .where(eq(riders.userId, s.body.user.id));
  if (opts.online !== false) {
    await call('POST', '/api/rider/status', s.cookie, { online: true });
    await call('POST', '/api/rider/location', s.cookie, MESKEL);
  }
  return { id: s.body.user.id as string, cookie: s.cookie };
}

let keyN = 0;
async function book(
  c: { cookie: string },
  payer: 'sender' | 'receiver' = 'sender',
  vehicle: 'motorcycle' | 'bicycle' = 'motorcycle',
) {
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
      payer,
      preferredPaymentMethod: 'cash',
      parcel: { description: 'Docs', size: 'small' },
    },
    { 'idempotency-key': `fin-key-${++keyN}` },
  );
  return res.json() as { id: string; code: string; fare: string };
}

async function acceptCurrent(r: { cookie: string }) {
  const offer = (await call('GET', '/api/rider/home', r.cookie)).json().offer;
  expect(offer).not.toBeNull();
  return call('POST', `/api/rider/offers/${offer.id}/accept`, r.cookie);
}
const step = (r: { cookie: string }, id: string, to: string) =>
  call('POST', `/api/rider/jobs/${id}/step`, r.cookie, { to });
const pay = (r: { cookie: string }, id: string, method = 'telebirr', reference?: string) =>
  call('POST', `/api/rider/jobs/${id}/payment`, r.cookie, { method, reference });

async function deliveredJob(r: { cookie: string }, c: { cookie: string }) {
  const d = await book(c);
  await acceptCurrent(r);
  for (const s of ['arrived_pickup', 'picked_up', 'arrived_dropoff']) await step(r, d.id, s);
  await pay(r, d.id, 'cash');
  await step(r, d.id, 'delivered');
  return d;
}

describe('fare payments', () => {
  it('records once (even when tapped twice at once); commission comes off once, on delivery', async () => {
    const r = await rider();
    const c = await customer();
    const d = await book(c);
    await acceptCurrent(r);
    await step(r, d.id, 'arrived_pickup');
    const results = await Promise.all([
      pay(r, d.id, 'telebirr', 'TB-123'),
      pay(r, d.id, 'telebirr', 'TB-123'),
      pay(r, d.id, 'cash'),
    ]);
    expect(results.every((x) => x.statusCode === 200)).toBe(true);
    const rows = await t.database.db.select().from(payments).where(eq(payments.deliveryId, d.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'fare',
      status: 'collected',
      amount: d.fare,
      method: 'telebirr',
      reference: 'TB-123',
    });
    const ledgerFor = () =>
      t.database.db.select().from(riderLedger).where(eq(riderLedger.deliveryId, d.id));
    // Recording the fare is not completion: nothing is deducted yet.
    expect(await ledgerFor()).toHaveLength(0);
    await step(r, d.id, 'picked_up');
    await step(r, d.id, 'arrived_dropoff');
    await Promise.all([step(r, d.id, 'delivered'), step(r, d.id, 'delivered')]);
    const ledger = await ledgerFor();
    expect(ledger).toHaveLength(1);
    const [row] = await t.database.db.select().from(deliveries).where(eq(deliveries.id, d.id));
    expect(ledger[0]!).toMatchObject({ type: 'commission', amount: row!.commissionAmount });

    const mine = (await call('GET', `/api/deliveries/${d.id}`, c.cookie)).json();
    expect(mine.farePayment).toEqual({ status: 'collected', method: 'telebirr' });
  });

  it('a receiver-paid fare cannot be recorded at the pickup', async () => {
    const r = await rider();
    const d = await book(await customer(), 'receiver');
    await acceptCurrent(r);
    await step(r, d.id, 'arrived_pickup');
    const early = await pay(r, d.id);
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('PAYMENT_NOT_ALLOWED');
    await step(r, d.id, 'picked_up');
    await step(r, d.id, 'arrived_dropoff');
    expect((await pay(r, d.id)).statusCode).toBe(200);
  });

  it('the fare can still be recorded after a failed delivery is returned', async () => {
    const r = await rider();
    const d = await book(await customer());
    await acceptCurrent(r);
    for (const s of ['arrived_pickup', 'picked_up', 'arrived_dropoff']) await step(r, d.id, s);
    for (let i = 0; i < 3; i++) {
      await call('POST', `/api/rider/jobs/${d.id}/contact-attempts`, r.cookie, {
        outcome: 'no_answer',
      });
      t.clock.advanceSeconds(301);
    }
    expect((await call('POST', `/api/rider/jobs/${d.id}/fail`, r.cookie)).statusCode).toBe(200);
    expect((await step(r, d.id, 'returned')).statusCode).toBe(200);
    expect((await pay(r, d.id, 'cash')).statusCode).toBe(200);
  });

  it('cancelling after arrival creates a due fee for the rider, with no commission', async () => {
    const r = await rider();
    const c = await customer();
    const d = await book(c);
    await acceptCurrent(r);
    await step(r, d.id, 'arrived_pickup');
    await call('POST', `/api/deliveries/${d.id}/cancel`, c.cookie, {});
    const [fee] = await t.database.db.select().from(payments).where(eq(payments.deliveryId, d.id));
    expect(fee).toMatchObject({ kind: 'cancellation_fee', status: 'due', amount: '40.00' });
    expect(
      await t.database.db.select().from(riderLedger).where(eq(riderLedger.deliveryId, d.id)),
    ).toHaveLength(0);

    const a = await admin();
    expect(
      (
        await call('POST', `/api/admin/payments/${fee!.id}/resolve`, a.cookie, {
          status: 'collected',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call('POST', `/api/admin/payments/${fee!.id}/resolve`, a.cookie, {
          status: 'collected',
          method: 'cash',
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (await call('POST', `/api/admin/payments/${fee!.id}/resolve`, a.cookie, { status: 'waived' }))
        .statusCode,
    ).toBe(409);
  });
});

describe('ledger and settlements', () => {
  it('cash top-ups credit the prepaid wallet idempotently; delivered jobs deduct commission', async () => {
    const r = await rider();
    const c = await customer();
    const a = await admin();
    const settle = (amount: string, key: string) =>
      call(
        'POST',
        `/api/admin/riders/${r.id}/settlements`,
        a.cookie,
        { amount, method: 'telebirr', reference: 'TX1' },
        { 'idempotency-key': key },
      );
    expect(
      (
        await call('POST', `/api/admin/riders/${r.id}/settlements`, a.cookie, {
          amount: '1',
          method: 'cash',
        })
      ).statusCode,
    ).toBe(400);

    const first = await settle('100', 'settle-key-1');
    expect(first.statusCode).toBe(201);
    // The ledger balance is what the rider owes; a credit is negative.
    expect(first.json().balance).toBe('-100.00');
    const repeat = await settle('100', 'settle-key-1');
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().balance).toBe('-100.00');

    const one = await deliveredJob(r, c);
    t.clock.advanceSeconds(60);
    await call('POST', '/api/rider/location', r.cookie, MESKEL);
    const two = await deliveredJob(r, c);
    const jobs = await t.database.db
      .select({ commission: deliveries.commissionAmount })
      .from(deliveries)
      .where(inArray(deliveries.id, [one.id, two.id]));
    const commissions = jobs.reduce((sum, j) => sum + Number(j.commission), 0);
    expect(commissions).toBeGreaterThan(0);

    const ledger = (await call('GET', `/api/admin/riders/${r.id}/ledger`, a.cookie)).json();
    expect((await call('GET', '/api/rider/ledger', r.cookie)).json().balance).toBe(ledger.balance);
    const wallet = (await call('GET', '/api/rider/wallet', r.cookie)).json();
    expect(Number(wallet.balance)).toBeCloseTo(-Number(ledger.balance), 2);
    expect(Number(wallet.balance)).toBeLessThan(100);
    expect(Number(wallet.balance)).toBeCloseTo(100 - commissions, 2);

    const recon = (await call('GET', '/api/admin/reconciliation', a.cookie)).json();
    const row = recon.riders.find((x: { riderId: string }) => x.riderId === r.id);
    expect(row).toMatchObject({ deliveries: 2, settled: '100.00', balance: ledger.balance });

    const csv = await call('GET', '/api/admin/reconciliation.csv', a.cookie);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.split('\n')[0]).toContain('outstanding_etb');
    expect(csv.body).toContain('Test Rider');

    const audits = await t.database.db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, 'rider.settlement'));
    expect(audits).toHaveLength(1);
    expect((await call('GET', '/api/admin/reconciliation', c.cookie)).statusCode).toBe(403);
  });
});

describe('pricing', () => {
  it('new rates apply to new bookings only; history is kept', async () => {
    const a = await admin();
    const c = await customer();
    const before = await book(c);
    const res = await call('POST', '/api/admin/pricing', a.cookie, {
      vehicleType: 'motorcycle',
      baseFare: '100',
      perKm: '20',
      minimumFare: '120',
      maxDistanceKm: null,
      commissionRate: 0.12,
      cancellationFeeAfterArrival: '40',
    });
    expect(res.statusCode).toBe(201);
    const after = await book(c);
    expect(Number(after.fare)).toBeGreaterThan(Number(before.fare));
    const [old] = await t.database.db.select().from(deliveries).where(eq(deliveries.id, before.id));
    expect(old!.fareAmount).toBe(before.fare);
    expect(old!.commissionRate).toBe('0.1500');
    const [fresh] = await t.database.db
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, after.id));
    expect(fresh!.commissionRate).toBe('0.1200');

    const rules = await t.database.db
      .select()
      .from(pricingRules)
      .where(eq(pricingRules.vehicleType, 'motorcycle'));
    expect(rules).toHaveLength(2);
    expect(rules.filter((r) => r.effectiveTo === null)).toHaveLength(1);

    const bad = await call('POST', '/api/admin/pricing', a.cookie, {
      vehicleType: 'bicycle',
      baseFare: '1',
      perKm: '1',
      minimumFare: '1',
      maxDistanceKm: 8,
      commissionRate: 0.9,
      cancellationFeeAfterArrival: '25',
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('admin delivery tools', () => {
  it('assigns a waiting delivery manually, and refuses busy riders or wrong vehicles', async () => {
    const a = await admin();
    const c = await customer();
    const d = await book(c); // nobody online → waits
    const idle = await rider({ online: false });
    const bike = await rider({ vehicle: 'bicycle', online: false });

    expect(
      (await call('POST', `/api/admin/deliveries/${d.id}/assign`, a.cookie, { riderId: bike.id }))
        .statusCode,
    ).toBe(409);
    expect(
      (await call('POST', `/api/admin/deliveries/${d.id}/assign`, a.cookie, { riderId: idle.id }))
        .statusCode,
    ).toBe(204);
    const detail = (await call('GET', `/api/admin/deliveries/${d.id}`, a.cookie)).json();
    expect(detail).toMatchObject({ status: 'assigned', rider: { id: idle.id } });
    expect(detail.events.at(-1)).toMatchObject({ to: 'assigned', actor: 'admin' });
    expect(detail.audit[0]).toMatchObject({ action: 'delivery.assign' });

    const d2 = await book(c);
    const res = await call('POST', `/api/admin/deliveries/${d2.id}/assign`, a.cookie, {
      riderId: idle.id,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('RIDER_BUSY');
    expect(
      (await call('POST', `/api/admin/deliveries/${d.id}/assign`, a.cookie, { riderId: idle.id }))
        .statusCode,
    ).toBe(409);
  });

  it('re-offer starts a new round, so a rider who let it lapse can be asked again', async () => {
    const a = await admin();
    const r = await rider();
    const d = await book(await customer());
    t.clock.advanceSeconds(25);
    await call('POST', '/api/rider/location', r.cookie, MESKEL);
    await t.dispatcher.tick();
    expect((await call('GET', '/api/rider/home', r.cookie)).json().offer).toBeNull(); // not asked twice

    const res = await call('POST', `/api/admin/deliveries/${d.id}/redispatch`, a.cookie);
    expect(res.json()).toEqual({ result: 'offered' });
    expect((await call('GET', '/api/rider/home', r.cookie)).json().offer).not.toBeNull();
    expect((await acceptCurrent(r)).statusCode).toBe(200);
  });

  it('admin cancellation charges the fee only when asked to, after arrival', async () => {
    const a = await admin();
    const r = await rider();
    const c = await customer();
    const d = await book(c);
    await acceptCurrent(r);
    await step(r, d.id, 'arrived_pickup');
    expect(
      (await call('POST', `/api/admin/deliveries/${d.id}/cancel`, a.cookie, { reason: 'x' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call('POST', `/api/admin/deliveries/${d.id}/cancel`, a.cookie, {
          reason: 'Customer asked by phone',
          chargeFee: true,
        })
      ).statusCode,
    ).toBe(204);
    const view = (await call('GET', `/api/deliveries/${d.id}`, c.cookie)).json();
    expect(view).toMatchObject({ status: 'cancelled', cancellationFee: '40.00' });

    const d2 = await book(c);
    await call('POST', `/api/admin/deliveries/${d2.id}/cancel`, a.cookie, {
      reason: 'Duplicate booking',
    });
    expect((await call('GET', `/api/deliveries/${d2.id}`, c.cookie)).json().cancellationFee).toBe(
      '0.00',
    );
  });

  it('lists and searches deliveries', async () => {
    const a = await admin();
    const d = await book(await customer());
    const all = (await call('GET', '/api/admin/deliveries', a.cookie)).json();
    expect(all.map((x: { id: string }) => x.id)).toContain(d.id);
    const byCode = (
      await call('GET', `/api/admin/deliveries?q=${d.code.toLowerCase()}`, a.cookie)
    ).json();
    expect(byCode).toHaveLength(1);
    expect(
      (await call('GET', '/api/admin/deliveries?status=delivered', a.cookie)).json(),
    ).toHaveLength(0);
  });
});

describe('admin user tools', () => {
  it('suspending signs the user out everywhere; admins cannot suspend themselves', async () => {
    const a = await admin();
    const r = await rider();
    expect(
      (
        await call('POST', `/api/admin/users/${a.id}/status`, a.cookie, {
          status: 'suspended',
          reason: 'test',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call('POST', `/api/admin/users/${r.id}/status`, a.cookie, {
          status: 'suspended',
          reason: 'Repeated no-shows',
        })
      ).statusCode,
    ).toBe(204);
    expect((await call('GET', '/api/auth/me', r.cookie)).statusCode).toBe(401);
    const [rr] = await t.database.db.select().from(riders).where(eq(riders.userId, r.id));
    expect(rr!.isOnline).toBe(false);
    const found = (await call('GET', '/api/admin/users?q=0944', a.cookie)).json();
    expect(found.find((u: { id: string }) => u.id === r.id)).toMatchObject({
      status: 'suspended',
      role: 'rider',
    });
  });
});
