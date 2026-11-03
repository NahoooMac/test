// Admin tools for the rider features: platform settings, wallets and top-up verification, points
// corrections, delivery history with route replay, and export. Every change is audited (who,
// when, why) in the same transaction as the change; viewing a recorded route is audited too.
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  pointsAdjustSchema,
  toSantim,
  settingsUpdateSchema,
  topupReviewSchema,
  walletAdjustSchema,
  type PlatformSettings,
} from '@dp/shared';
import type { Db } from '../../db/client.ts';
import { deliveries, riderLedger, riderPoints, riders, users, walletTopups } from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, parseInput } from '../../shared/errors.ts';
import type { Authenticator } from '../auth/http.ts';
import { HISTORY_GROUPS, historyDetail, historyWhere } from '../history/service.ts';
import { getSettings, updateSettings } from '../platform/settings.ts';
import { riderAreas } from '../riders/eligibility.ts';
import { adjustPoints, pointsHistory } from '../riders/points.ts';
import { ratingSummary } from '../riders/preferences.ts';
import { adjustWallet, eligibilityFrom, reviewTopup, walletEntries } from '../wallet/wallet.ts';
import { audit } from './audit.ts';

type IdParams = { Params: { id: string } };

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
const notFound = () => new AppError(404, 'NOT_FOUND', 'Not found.');
const topupQuery = z.object({ status: z.enum(['pending', 'verified', 'rejected']).optional() });
const adminHistoryQuery = z.object({
  group: z.enum(['completed', 'unsuccessful']).optional(),
  status: z.string().max(30).optional(),
  vehicle: z.enum(['motorcycle', 'bicycle']).optional(),
  riderId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(12).optional(),
});

/** Escapes a CSV field (quotes, commas, newlines) and neutralises spreadsheet formulas. */
function csv(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Wallet balance in ETB (rider's view): −SUM(ledger). */
const balanceSql = sql<string>`(-coalesce((select sum(l.amount) from ${riderLedger} l where l.rider_id = "riders"."user_id"), 0))::numeric(12,2)::text`;
const pointsSql = sql<number>`(select coalesce(sum(p.delta), 0) from ${riderPoints} p where p.rider_id = "riders"."user_id")`;
const pendingTopupsSql = sql<number>`(select count(*) from ${walletTopups} t where t.rider_id = "riders"."user_id" and t.status = 'pending')`;

export async function adminRiderFeatureRoutes(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Authenticator },
) {
  const { db, clock, auth } = deps;

  // ── Settings ───────────────────────────────────────────────────────────────

  app.get('/admin/settings/platform', async (req, reply): Promise<PlatformSettings> => {
    await auth.require(req, reply, 'admin');
    reply.header('Cache-Control', 'no-store');
    return getSettings(db);
  });

  app.put('/admin/settings/platform', async (req, reply): Promise<PlatformSettings> => {
    const { user } = await auth.require(req, reply, 'admin');
    const input = parseInput(settingsUpdateSchema, req.body);
    return db.transaction((tx) => updateSettings(tx, user.id, input, clock.now()));
  });

  // ── Wallets ────────────────────────────────────────────────────────────────

  app.get('/admin/wallets', async (req, reply) => {
    await auth.require(req, reply, 'admin');
    const [s, rows] = await Promise.all([
      getSettings(db),
      db
        .select({
          id: riders.userId,
          name: users.fullName,
          phone: users.phoneE164,
          vehicleType: riders.vehicleType,
          approvalStatus: riders.approvalStatus,
          balance: balanceSql,
          points: pointsSql.mapWith(Number),
          pendingTopups: pendingTopupsSql.mapWith(Number),
        })
        .from(riders)
        .innerJoin(users, eq(users.id, riders.userId))
        .orderBy(sql`(-coalesce((select sum(l.amount) from ${riderLedger} l where l.rider_id = "riders"."user_id"), 0))`)
        .limit(500),
    ]);
    reply.header('Cache-Control', 'no-store');
    return rows.map((r) => {
      const e = eligibilityFrom(toSantim(r.balance), s);
      return { ...r, ...e };
    });
  });

  /** One rider's full picture: wallet + ledger, top-ups, points history, areas, rating. */
  app.get<IdParams>('/admin/riders/:id/features', async (req, reply) => {
    await auth.require(req, reply, 'admin');
    if (!isUuid(req.params.id)) throw notFound();
    const id = req.params.id;
    const [r] = await db
      .select({ homeLat: riders.homeLat, homeLng: riders.homeLng, radius: riders.homeRadiusKm })
      .from(riders)
      .where(eq(riders.userId, id));
    if (!r) throw notFound();
    const [s, balance, entries, topups, points, history, areas, rating] = await Promise.all([
      getSettings(db),
      db
        .select({ b: sql<string>`(-coalesce(sum(${riderLedger.amount}), 0))::numeric(12,2)::text` })
        .from(riderLedger)
        .where(eq(riderLedger.riderId, id)),
      walletEntries(db, id, 200),
      db
        .select()
        .from(walletTopups)
        .where(eq(walletTopups.riderId, id))
        .orderBy(desc(walletTopups.createdAt))
        .limit(50),
      db
        .select({ total: sql<number>`coalesce(sum(${riderPoints.delta}), 0)`.mapWith(Number) })
        .from(riderPoints)
        .where(eq(riderPoints.riderId, id)),
      pointsHistory(db, id, 200),
      riderAreas(db, id),
      ratingSummary(db, id),
    ]);
    reply.header('Cache-Control', 'no-store');
    return {
      wallet: eligibilityFrom(toSantim(balance[0]?.b ?? '0'), s),
      entries,
      topups: topups.map(topupRow),
      points: points[0]?.total ?? 0,
      pointsHistory: history,
      serviceAreas: areas,
      home: r.homeLat != null && r.homeLng != null ? { lat: r.homeLat, lng: r.homeLng, radiusKm: r.radius ?? 3 } : null,
      rating,
    };
  });

  app.post<IdParams>('/admin/riders/:id/wallet/adjust', async (req, reply) => {
    const { user } = await auth.require(req, reply, 'admin');
    if (!isUuid(req.params.id)) throw notFound();
    const { amount, reason } = parseInput(walletAdjustSchema, req.body);
    return adjustWallet(db, user.id, req.params.id, amount, reason, clock.now());
  });

  app.post<IdParams>('/admin/riders/:id/points/adjust', async (req, reply) => {
    const { user } = await auth.require(req, reply, 'admin');
    if (!isUuid(req.params.id)) throw notFound();
    const input = parseInput(pointsAdjustSchema, req.body);
    return { points: await adjustPoints(db, user.id, req.params.id, input, clock.now()) };
  });

  // ── Top-up verification ────────────────────────────────────────────────────

  app.get('/admin/topups', async (req, reply) => {
    await auth.require(req, reply, 'admin');
    const { status } = parseInput(topupQuery, req.query);
    const rows = await db
      .select({ t: walletTopups, name: users.fullName, phone: users.phoneE164 })
      .from(walletTopups)
      .innerJoin(users, eq(users.id, walletTopups.riderId))
      .where(status ? eq(walletTopups.status, status) : undefined)
      .orderBy(status === 'pending' ? walletTopups.createdAt : desc(walletTopups.createdAt))
      .limit(300);
    reply.header('Cache-Control', 'no-store');
    return rows.map(({ t, name, phone }) => ({ ...topupRow(t), riderId: t.riderId, riderName: name, phone }));
  });

  app.post<IdParams>('/admin/topups/:id/review', async (req, reply) => {
    const { user } = await auth.require(req, reply, 'admin');
    if (!isUuid(req.params.id)) throw notFound();
    const { decision, note } = parseInput(topupReviewSchema, req.body);
    return reviewTopup(db, user.id, req.params.id, decision, note, clock.now());
  });

  // ── Delivery history, route replay and export ──────────────────────────────

  const finishedStatuses = [...HISTORY_GROUPS.completed, ...HISTORY_GROUPS.unsuccessful];
  const riderName = sql<string | null>`(select full_name from ${users} where id = "deliveries"."rider_id")`;
  const commission = sql<string | null>`(select l.amount::text from ${riderLedger} l where l.delivery_id = "deliveries"."id" and l.type = 'commission' limit 1)`;
  const pointCount = sql<number>`(select count(*) from delivery_route_points p where p.delivery_id = "deliveries"."id")`;

  async function historyRows(q: z.output<typeof adminHistoryQuery>, limit: number) {
    const base = and(
      inArray(deliveries.status, finishedStatuses),
      q.riderId ? eq(deliveries.riderId, q.riderId) : undefined,
    );
    return db
      .select({ d: deliveries, riderName, commission, pointCount: pointCount.mapWith(Number) })
      .from(deliveries)
      .where(historyWhere(q, base))
      .orderBy(desc(deliveries.updatedAt))
      .limit(limit);
  }

  app.get('/admin/history', async (req, reply) => {
    await auth.require(req, reply, 'admin');
    const q = parseInput(adminHistoryQuery, req.query);
    const rows = await historyRows(q, 300);
    reply.header('Cache-Control', 'no-store');
    return rows.map(({ d, riderName: name, commission: c, pointCount: n }) => ({
      id: d.id,
      code: d.publicCode,
      status: d.status,
      vehicleType: d.vehicleType,
      riderId: d.riderId,
      riderName: name,
      pickupAddress: d.pickupAddress,
      dropoffAddress: d.dropoffAddress,
      fare: d.fareAmount,
      commission: c,
      distanceKm: d.distanceKm,
      routePoints: n,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    }));
  });

  app.get('/admin/history.csv', async (req, reply) => {
    const { user } = await auth.require(req, reply, 'admin');
    const q = parseInput(adminHistoryQuery, req.query);
    const rows = await historyRows(q, 5000);
    await audit(db, user.id, 'history.export', { type: 'deliveries', id: 'history' }, {
      filters: { ...q, from: q.from?.toISOString(), to: q.to?.toISOString() },
      rows: rows.length,
    });
    const header = [
      'code',
      'status',
      'vehicle',
      'rider',
      'pickup',
      'dropoff',
      'planned_km',
      'fare_etb',
      'commission_etb',
      'rider_earning_etb',
      'route_points',
      'created_at',
      'finished_at',
    ];
    const lines = rows.map(({ d, riderName: name, commission: c, pointCount: n }) =>
      [
        d.publicCode,
        d.status,
        d.vehicleType,
        name,
        d.pickupAddress,
        d.dropoffAddress,
        d.distanceKm,
        d.fareAmount,
        c,
        d.riderEarning,
        n,
        d.createdAt.toISOString(),
        (d.deliveredAt ?? d.returnedAt ?? d.cancelledAt)?.toISOString() ?? '',
      ]
        .map(csv)
        .join(','),
    );
    const date = clock.now().toISOString().slice(0, 10);
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="delivery-history-${date}.csv"`);
    return [header.join(','), ...lines].join('\n') + '\n';
  });

  // The recorded route is location data about a rider; each view is audited.
  app.get<IdParams>('/admin/deliveries/:id/history', async (req, reply) => {
    const { user } = await auth.require(req, reply, 'admin');
    if (!isUuid(req.params.id)) throw notFound();
    const [d] = await db.select().from(deliveries).where(eq(deliveries.id, req.params.id));
    if (!d) throw notFound();
    const detail = await historyDetail(db, d);
    await audit(db, user.id, 'delivery.route_view', { type: 'delivery', id: d.id }, {
      points: detail.route.length,
    });
    reply.header('Cache-Control', 'no-store');
    return { ...detail, riderId: d.riderId };
  });
}

function topupRow(t: typeof walletTopups.$inferSelect) {
  return {
    id: t.id,
    amount: t.amount,
    method: t.method,
    reference: t.reference,
    status: t.status,
    reviewNote: t.reviewNote,
    createdAt: t.createdAt.toISOString(),
    reviewedAt: t.reviewedAt?.toISOString() ?? null,
  };
}
