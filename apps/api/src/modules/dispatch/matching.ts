// Explainable rider ranking. Only riders who already pass every mandatory rule are scored; the
// score orders them. Each part is returned so admins can see why a rider was chosen.
//
//   score = − distancePerKm × km to pickup
//           + homeBonus      (pickup within the rider's home radius)
//           + ratingPerStar  × (Bayesian rating − 4.5)     new riders start at a neutral 4.5
//           + pointsPerPoint × clamp(points − 50, ±50)     new riders start at 0
//           + idlePerHour    × min(hours since last job, 8) fair turn for idle / new riders
//           − cancelPenalty  × rider cancellations in 30 days
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { haversineKm, type LatLng, type MatchingWeights } from '@dp/shared';
import type { Tx } from '../../db/client.ts';
import { deliveries, deliveryRatings, riderPoints, riders } from '../../db/schema.ts';

/** Bayesian average: C pseudo-ratings at the prior, so 1–2 ratings can't swing a new rider. */
const PRIOR_STARS = 4.5;
const PRIOR_WEIGHT = 5;
const IDLE_CAP_H = 8;
const NEW_RIDER_IDLE_H = IDLE_CAP_H;

export interface RiderSignals {
  riderId: string;
  home: { lat: number; lng: number; radiusKm: number } | null;
  points: number;
  ratingSum: number;
  ratingCount: number;
  lastJobAt: Date | null;
  recentCancellations: number;
}

export function bayesianRating(sum: number, count: number) {
  return (PRIOR_STARS * PRIOR_WEIGHT + sum) / (PRIOR_WEIGHT + count);
}

export function scoreRider(
  s: RiderSignals,
  toPickupKm: number,
  pickup: LatLng,
  w: MatchingWeights,
  now: Date,
): { total: number; parts: Record<string, number> } {
  const nearHome = !!s.home && haversineKm(s.home, pickup) <= s.home.radiusKm;
  const idleH = s.lastJobAt
    ? Math.min((now.getTime() - s.lastJobAt.getTime()) / 3_600_000, IDLE_CAP_H)
    : NEW_RIDER_IDLE_H;
  const parts = {
    distance: -w.distancePerKm * toPickupKm,
    home: nearHome ? w.homeBonus : 0,
    rating: w.ratingPerStar * (bayesianRating(s.ratingSum, s.ratingCount) - PRIOR_STARS),
    points: w.pointsPerPoint * Math.max(-50, Math.min(50, s.points - 50)),
    fairness: w.idlePerHour * idleH,
    reliability: -w.cancelPenalty * s.recentCancellations,
  };
  const round = (n: number) => Math.round(n * 100) / 100;
  const rounded = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round(v)]));
  return { total: round(Object.values(parts).reduce((a, b) => a + b, 0)), parts: rounded };
}

export async function loadSignals(db: Tx, riderIds: string[], now: Date): Promise<Map<string, RiderSignals>> {
  const out = new Map<string, RiderSignals>();
  if (riderIds.length === 0) return out;
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [base, points, ratings, lastJobs, cancels] = await Promise.all([
    db
      .select({ id: riders.userId, lat: riders.homeLat, lng: riders.homeLng, r: riders.homeRadiusKm })
      .from(riders)
      .where(inArray(riders.userId, riderIds)),
    db
      .select({ id: riderPoints.riderId, total: sql<number>`sum(${riderPoints.delta})`.mapWith(Number) })
      .from(riderPoints)
      .where(inArray(riderPoints.riderId, riderIds))
      .groupBy(riderPoints.riderId),
    db
      .select({
        id: deliveryRatings.riderId,
        sum: sql<number>`sum(${deliveryRatings.stars})`.mapWith(Number),
        n: sql<number>`count(*)`.mapWith(Number),
      })
      .from(deliveryRatings)
      .where(and(inArray(deliveryRatings.riderId, riderIds), eq(deliveryRatings.status, 'active')))
      .groupBy(deliveryRatings.riderId),
    db
      .select({ id: deliveries.riderId, at: sql<string | null>`max(${deliveries.assignedAt})` })
      .from(deliveries)
      .where(inArray(deliveries.riderId, riderIds))
      .groupBy(deliveries.riderId),
    db
      .select({ id: riderPoints.riderId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(riderPoints)
      .where(
        and(
          inArray(riderPoints.riderId, riderIds),
          eq(riderPoints.type, 'rider_cancellation'),
          gte(riderPoints.createdAt, since),
        ),
      )
      .groupBy(riderPoints.riderId),
  ]);
  const by = <T extends { id: string | null }>(rows: T[]) => new Map(rows.map((r) => [r.id!, r]));
  const p = by(points);
  const r = by(ratings);
  const l = by(lastJobs);
  const c = by(cancels);
  for (const b of base) {
    out.set(b.id, {
      riderId: b.id,
      home: b.lat != null && b.lng != null ? { lat: b.lat, lng: b.lng, radiusKm: b.r ?? 3 } : null,
      points: p.get(b.id)?.total ?? 50,
      ratingSum: r.get(b.id)?.sum ?? 0,
      ratingCount: r.get(b.id)?.n ?? 0,
      lastJobAt: l.get(b.id)?.at ? new Date(l.get(b.id)!.at!) : null,
      recentCancellations: c.get(b.id)?.n ?? 0,
    });
  }
  return out;
}
