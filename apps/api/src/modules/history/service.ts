// Delivery history and the rider's actual GPS route.
//
// Route points come from the rider app's queue (it keeps fixes while offline and uploads them in
// batches). The server accepts a fix only if it belongs to this rider's job and falls inside the
// job's own time window, drops inaccurate fixes and physically impossible jumps, stores each fix
// once (re-sent batches are harmless), and assigns the stage from the delivery's timestamps.
// Nothing is ever interpolated or invented: missing GPS is shown as missing.
import { and, asc, desc, eq, gte, inArray, lt, lte, sql, type SQL } from 'drizzle-orm';
import {
  haversineKm,
  type DeliveryHistoryDetail,
  type DeliveryHistoryRow,
  type RoutePoint,
  type routePointsSchema,
} from '@dp/shared';
import type { z } from 'zod';
import type { Db } from '../../db/client.ts';
import {
  deliveries,
  deliveryEvents,
  deliveryRatings,
  deliveryRoutePoints,
  riderLedger,
} from '../../db/schema.ts';
import { AppError } from '../../shared/errors.ts';

type DeliveryRow = typeof deliveries.$inferSelect;

/** Fixes worse than this are too vague to draw as the route. */
const MAX_ACCURACY_M = 150;
/** Faster than this between consecutive fixes is a GPS glitch, not a motorcycle (≈180 km/h). */
const MAX_SPEED_MPS = 50;
const WINDOW_BEFORE_MS = 2 * 60_000;
const WINDOW_AFTER_MS = 5 * 60_000;
const FUTURE_SLACK_MS = 2 * 60_000;

const finishedAt = (d: DeliveryRow) => d.deliveredAt ?? d.returnedAt ?? d.cancelledAt ?? null;

function stageAt(d: DeliveryRow, at: Date): RoutePoint['stage'] {
  if (d.failedAt && at >= d.failedAt) return 'returning';
  if (d.pickedUpAt && at >= d.pickedUpAt) return 'to_dropoff';
  return 'to_pickup';
}

export async function ingestRoute(
  db: Db,
  riderId: string,
  deliveryId: string,
  input: z.output<typeof routePointsSchema>,
  now: Date,
): Promise<{ accepted: number; rejected: number }> {
  if (!/^[0-9a-f-]{36}$/i.test(deliveryId)) throw new AppError(404, 'NOT_FOUND', 'Not found.');
  const [d] = await db
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.riderId, riderId)));
  if (!d || !d.assignedAt) throw new AppError(404, 'NOT_FOUND', 'Not found.');

  const start = d.assignedAt.getTime() - WINDOW_BEFORE_MS;
  const end = finishedAt(d) ? finishedAt(d)!.getTime() + WINDOW_AFTER_MS : now.getTime() + FUTURE_SLACK_MS;
  const sorted = [...input.points]
    .map((p) => ({ ...p, at: new Date(p.recordedAt) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  // The last stored fix before this batch, to check the first new fix for a jump.
  const [prevRow] = await db
    .select({ lat: deliveryRoutePoints.lat, lng: deliveryRoutePoints.lng, at: deliveryRoutePoints.recordedAt })
    .from(deliveryRoutePoints)
    .where(
      and(
        eq(deliveryRoutePoints.deliveryId, deliveryId),
        lt(deliveryRoutePoints.recordedAt, sorted[0]!.at),
      ),
    )
    .orderBy(desc(deliveryRoutePoints.recordedAt))
    .limit(1);
  let prev = prevRow ?? null;

  const keep: (typeof deliveryRoutePoints.$inferInsert)[] = [];
  for (const p of sorted) {
    const t = p.at.getTime();
    const inWindow = t >= start && t <= end && t <= now.getTime() + FUTURE_SLACK_MS;
    const accurate = p.accuracyM === undefined || p.accuracyM <= MAX_ACCURACY_M;
    const plausible =
      !prev ||
      t <= prev.at.getTime() ||
      (haversineKm(prev, p) * 1000) / ((t - prev.at.getTime()) / 1000) <= MAX_SPEED_MPS;
    if (!inWindow || !accurate || !plausible) continue;
    keep.push({
      deliveryId,
      riderId,
      lat: Math.round(p.lat * 1e6) / 1e6,
      lng: Math.round(p.lng * 1e6) / 1e6,
      recordedAt: p.at,
      stage: stageAt(d, p.at),
      accuracyM: p.accuracyM !== undefined ? Math.round(p.accuracyM) : null,
      receivedAt: now,
    });
    prev = { lat: p.lat, lng: p.lng, at: p.at };
  }
  let accepted = 0;
  if (keep.length) {
    const inserted = await db
      .insert(deliveryRoutePoints)
      .values(keep)
      .onConflictDoNothing()
      .returning({ id: deliveryRoutePoints.id });
    accepted = inserted.length;
  }
  return { accepted, rejected: input.points.length - keep.length };
}

export async function routeFor(db: Db, deliveryId: string): Promise<RoutePoint[]> {
  const rows = await db
    .select()
    .from(deliveryRoutePoints)
    .where(eq(deliveryRoutePoints.deliveryId, deliveryId))
    .orderBy(asc(deliveryRoutePoints.recordedAt));
  return rows.map((r) => ({
    lat: r.lat,
    lng: r.lng,
    at: r.recordedAt.toISOString(),
    stage: r.stage,
    accuracyM: r.accuracyM,
  }));
}

export function recordedKm(route: RoutePoint[]): number | null {
  if (route.length < 2) return null;
  let km = 0;
  for (let i = 1; i < route.length; i++) km += haversineKm(route[i - 1]!, route[i]!);
  return Math.round(km * 100) / 100;
}

// ── History ──────────────────────────────────────────────────────────────────

export const HISTORY_GROUPS = {
  completed: ['delivered'],
  unsuccessful: ['cancelled', 'failed', 'returning', 'returned'],
} as const;

export interface HistoryFilter {
  group?: 'completed' | 'unsuccessful' | undefined;
  status?: string | undefined;
  vehicle?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  q?: string | undefined;
}

const commissionSql = sql<string | null>`(select l.amount::text from ${riderLedger} l where l.delivery_id = "deliveries"."id" and l.type = 'commission' limit 1)`;

function rowDto(d: DeliveryRow, commission: string | null): DeliveryHistoryRow {
  return {
    id: d.id,
    code: d.publicCode,
    status: d.status,
    vehicleType: d.vehicleType,
    pickupAddress: d.pickupAddress,
    dropoffAddress: d.dropoffAddress,
    fare: d.fareAmount,
    commission,
    riderEarning: d.riderEarning,
    cancellationFee: d.cancellationFee,
    createdAt: d.createdAt.toISOString(),
    finishedAt: finishedAt(d)?.toISOString() ?? null,
  };
}

export function historyWhere(f: HistoryFilter, base: SQL | undefined): SQL | undefined {
  const parts: (SQL | undefined)[] = [base];
  if (f.group) parts.push(inArray(deliveries.status, [...HISTORY_GROUPS[f.group]]));
  if (f.status) parts.push(sql`${deliveries.status}::text = ${f.status}`);
  if (f.vehicle) parts.push(sql`${deliveries.vehicleType}::text = ${f.vehicle}`);
  if (f.from) parts.push(gte(deliveries.createdAt, f.from));
  if (f.to) parts.push(lte(deliveries.createdAt, f.to));
  if (f.q) parts.push(sql`upper(${deliveries.publicCode}) = upper(${f.q})`);
  return and(...parts);
}

/** A rider's own past jobs, newest first. Never another rider's. */
export async function riderHistory(db: Db, riderId: string, f: HistoryFilter) {
  const rows = await db
    .select({ d: deliveries, commission: commissionSql })
    .from(deliveries)
    .where(
      historyWhere(f, and(eq(deliveries.riderId, riderId), inArray(deliveries.status, [
        ...HISTORY_GROUPS.completed,
        ...HISTORY_GROUPS.unsuccessful,
      ]))),
    )
    .orderBy(desc(sql`coalesce(${deliveries.deliveredAt}, ${deliveries.returnedAt}, ${deliveries.cancelledAt}, ${deliveries.updatedAt})`))
    .limit(100);
  return rows.map(({ d, commission }) => rowDto(d, commission));
}

/** Full record of one delivery: timeline, money, rating and the recorded route. */
export async function historyDetail(db: Db, d: DeliveryRow): Promise<DeliveryHistoryDetail> {
  const [events, route, commission, rating] = await Promise.all([
    db
      .select()
      .from(deliveryEvents)
      .where(eq(deliveryEvents.deliveryId, d.id))
      .orderBy(asc(deliveryEvents.createdAt)),
    routeFor(db, d.id),
    db
      .select({ amount: riderLedger.amount })
      .from(riderLedger)
      .where(and(eq(riderLedger.deliveryId, d.id), eq(riderLedger.type, 'commission'))),
    db
      .select({ stars: deliveryRatings.stars, comment: deliveryRatings.comment })
      .from(deliveryRatings)
      .where(and(eq(deliveryRatings.deliveryId, d.id), eq(deliveryRatings.status, 'active'))),
  ]);
  const deducted = commission[0]?.amount ?? null;
  const end = finishedAt(d);
  return {
    ...rowDto(d, deducted),
    pickup: { address: d.pickupAddress, subCity: d.pickupSubCity, lat: d.pickupLat, lng: d.pickupLng },
    dropoff: { address: d.dropoffAddress, subCity: d.dropoffSubCity, lat: d.dropoffLat, lng: d.dropoffLng },
    distanceKm: d.distanceKm,
    distanceSource: d.distanceSource,
    commissionDeducted: deducted,
    cancelReason: d.cancelReason,
    cancelledBy: d.cancelledBy,
    timeline: events.map((e) => ({ status: e.toStatus, at: e.createdAt.toISOString(), actor: e.actorRole })),
    route,
    recordedKm: recordedKm(route),
    durationMin:
      d.assignedAt && end ? Math.round((end.getTime() - d.assignedAt.getTime()) / 60_000) : null,
    rating: rating[0] ? { stars: rating[0].stars, comment: rating[0].comment } : null,
  };
}

export async function riderHistoryDetail(db: Db, riderId: string, deliveryId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(deliveryId)) throw new AppError(404, 'NOT_FOUND', 'Not found.');
  const [d] = await db
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.riderId, riderId)));
  if (!d) throw new AppError(404, 'NOT_FOUND', 'Not found.');
  return historyDetail(db, d);
}

/** Retention: route points older than the configured number of days are deleted. */
export async function purgeOldRoutes(db: Db, retentionDays: number, now: Date) {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  const removed = await db
    .delete(deliveryRoutePoints)
    .where(lt(deliveryRoutePoints.recordedAt, cutoff))
    .returning({ id: deliveryRoutePoints.id });
  return removed.length;
}
