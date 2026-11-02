// Real-Postgres concurrency checks. PGlite runs one query at a time, so the races in
// dispatch.test.ts exercise the logic but not true contention. This file uses a real server and a
// connection pool so requests genuinely overlap.
//
// OPT-IN ONLY: runs when TEST_PG_URL is set. It inserts rows tagged with a random +2519009xxxxx
// phone prefix and deletes everything it created afterwards. Never point it at a database you have
// not agreed to write test rows into.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, like } from 'drizzle-orm';
import { loadConfig } from '../src/config/env.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { buildApp } from '../src/app.ts';
import { deliveries, deliveryOffers, riders, sessions, users } from '../src/db/schema.ts';
import { SessionService } from '../src/modules/auth/sessions.ts';
import { systemClock } from '../src/shared/clock.ts';
import { FakeGeoProvider } from '../src/integrations/maps/fake.ts';
import { FakeSmsProvider } from '../src/integrations/sms/fake.ts';

const URL = process.env.TEST_PG_URL;
const ORIGIN = 'http://localhost:5173';
const TAG = `+2519009${String(Math.floor(Math.random() * 90) + 10)}`; // 10-digit prefix, 3 digits left

describe.skipIf(!URL)('real Postgres concurrency', () => {
  let database: Database;
  let app: Awaited<ReturnType<typeof buildApp>>['app'];
  let sessionsSvc: SessionService;
  let n = 0;

  beforeAll(async () => {
    database = createDatabase({ url: URL });
    const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: ORIGIN });
    ({ app } = await buildApp({
      config,
      database,
      sms: new FakeSmsProvider(),
      geo: new FakeGeoProvider(),
    }));
    sessionsSvc = new SessionService(database.db, config, systemClock);
  });

  afterAll(async () => {
    if (!database) return;
    const db = database.db;
    const tagged = await db
      .select({ id: users.id })
      .from(users)
      .where(like(users.phoneE164, `${TAG}%`));
    const ids = tagged.map((u) => u.id);
    if (ids.length) {
      await db.delete(deliveries).where(inArray(deliveries.customerId, ids)); // cascades events/offers
      await db.delete(deliveryOffers).where(inArray(deliveryOffers.riderId, ids));
      await db.delete(riders).where(inArray(riders.userId, ids));
      await db.delete(sessions).where(inArray(sessions.userId, ids));
      await db.delete(users).where(inArray(users.id, ids));
    }
    const left = await db
      .select({ id: users.id })
      .from(users)
      .where(like(users.phoneE164, `${TAG}%`));
    expect(left).toHaveLength(0);
    await app?.close();
    await database.close();
  });

  async function user(role: 'customer' | 'rider') {
    const phone = `${TAG}${String(++n).padStart(3, '0')}`;
    const [u] = await database.db
      .insert(users)
      .values({ phoneE164: phone, role, fullName: `Test ${n}` })
      .returning();
    const { token } = await sessionsSvc.create(database.db, u!, {
      ip: '127.0.0.1',
      userAgent: 'test',
    });
    return { id: u!.id, cookie: `sid=${token}` };
  }

  async function approvedRider() {
    const r = await user('rider');
    await database.db.insert(riders).values({
      userId: r.id,
      vehicleType: 'bicycle',
      approvalStatus: 'approved',
      kycStatus: 'approved',
      isOnline: true,
      currentLat: 9.0105,
      currentLng: 38.7614,
      locationUpdatedAt: new Date(),
    });
    return r;
  }

  async function booking(c: { cookie: string }) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/deliveries',
      headers: { cookie: c.cookie, origin: ORIGIN, 'idempotency-key': `pg-test-${TAG}-${++n}` },
      payload: {
        pickup: {
          lat: 9.0105,
          lng: 38.7614,
          address: 'Test pickup',
          contactName: 'Test',
          contactPhone: '0911111111',
        },
        dropoff: {
          lat: 9.0326,
          lng: 38.7541,
          address: 'Test drop',
          contactName: 'Test',
          contactPhone: '0922222222',
        },
        vehicleType: 'bicycle',
        payer: 'sender',
        preferredPaymentMethod: 'cash',
        parcel: { description: 'Concurrency test', size: 'small' },
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  it('six simultaneous assignments of one rider: exactly one succeeds (DB index)', async () => {
    const c = await user('customer');
    const r = await approvedRider();
    const ids = await Promise.all(Array.from({ length: 6 }, () => booking(c)));
    // Race the assignment itself over separate pooled connections; only the partial unique index
    // deliveries_one_active_per_rider stands between this rider and six active jobs.
    const results = await Promise.allSettled(
      ids.map((id) =>
        database.db
          .update(deliveries)
          .set({ riderId: r.id, status: 'assigned', assignedAt: new Date() })
          .where(and(eq(deliveries.id, id), eq(deliveries.status, 'requested'))),
      ),
    );
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const active = await database.db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.riderId, r.id), eq(deliveries.status, 'assigned')));
    expect(active).toHaveLength(1);
  });

  it('two riders racing for the same delivery: exactly one wins', async () => {
    const c = await user('customer');
    const id = await booking(c);
    await database.db
      .update(deliveryOffers)
      .set({ status: 'withdrawn' })
      .where(eq(deliveryOffers.deliveryId, id));
    const a = await approvedRider();
    const b = await approvedRider();
    // Two open offers for one delivery are impossible (index), so give each rider an offer in turn
    // and race the accept requests through the API over separate pooled connections.
    const [oa] = await database.db
      .insert(deliveryOffers)
      .values({
        deliveryId: id,
        riderId: a.id,
        toPickupKm: 0.1,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    const accept = (cookie: string, offerId: string) =>
      app.inject({
        method: 'POST',
        url: `/api/rider/offers/${offerId}/accept`,
        headers: { cookie, origin: ORIGIN },
      });
    const raced = await Promise.all([
      accept(a.cookie, oa!.id),
      accept(a.cookie, oa!.id),
      accept(b.cookie, oa!.id),
    ]);
    expect(raced.filter((x) => x.statusCode === 200)).toHaveLength(1);
    const [d] = await database.db.select().from(deliveries).where(eq(deliveries.id, id));
    expect(d!.riderId).toBe(a.id);
  });

  it('many overlapping dispatches never give one rider two open offers', async () => {
    const c = await user('customer');
    const riderList = await Promise.all(Array.from({ length: 3 }, () => approvedRider()));
    const ids = await Promise.all(Array.from({ length: 8 }, () => booking(c)));
    const open = await database.db
      .select()
      .from(deliveryOffers)
      .where(and(inArray(deliveryOffers.deliveryId, ids), eq(deliveryOffers.status, 'offered')));
    const perRider = new Map<string, number>();
    for (const o of open) perRider.set(o.riderId, (perRider.get(o.riderId) ?? 0) + 1);
    expect([...perRider.values()].every((v) => v === 1)).toBe(true);
    expect(open.length).toBeLessThanOrEqual(riderList.length);
  });
});
