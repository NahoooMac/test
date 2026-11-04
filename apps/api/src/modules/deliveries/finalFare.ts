// Final fare at the destination (business rule): when the rider ends the delivery, the price is
// recalculated from the distance actually travelled and the journey time, using the pricing rule
// recorded at booking. The rider never enters or edits the amount.
//
// Distance comes from the recorded GPS route (pickup → drop-off stage) when it is credible.
// Otherwise the booking distance is used and the fare is marked `estimate`:
//  - fewer than two GPS fixes, or the fixes cover less than half the planned distance (the
//    phone was offline, GPS was off): too little data to charge on;
//  - more than twice the planned distance (+3 km): capped there, so GPS jitter or a detour
//    cannot inflate the customer's price without limit.
import { and, asc, eq, gte } from 'drizzle-orm';
import { haversineKm, toSantim } from '@dp/shared';
import type { Tx } from '../../db/client.ts';
import { deliveries, deliveryRoutePoints, pricingRules } from '../../db/schema.ts';
import { computeFinalFare } from '../pricing/pricing.ts';

type DeliveryRow = typeof deliveries.$inferSelect;

const MIN_COVERAGE = 0.5;
const MAX_FACTOR = 2;
const MAX_EXTRA_KM = 3;

export interface FinalFareResult {
  fare: string;
  commissionAmount: string;
  riderEarning: string;
  actualDistanceKm: number;
  actualDurationMin: number;
  basis: 'gps' | 'estimate';
}

/** Distance (km) of the recorded pickup → drop-off route, or null without enough fixes. */
export async function journeyKm(tx: Tx, d: DeliveryRow): Promise<number | null> {
  if (!d.pickedUpAt) return null;
  const pts = await tx
    .select({ lat: deliveryRoutePoints.lat, lng: deliveryRoutePoints.lng })
    .from(deliveryRoutePoints)
    .where(
      and(
        eq(deliveryRoutePoints.deliveryId, d.id),
        eq(deliveryRoutePoints.stage, 'to_dropoff'),
        gte(deliveryRoutePoints.recordedAt, d.pickedUpAt),
      ),
    )
    .orderBy(asc(deliveryRoutePoints.recordedAt));
  if (pts.length < 2) return null;
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += haversineKm(pts[i - 1]!, pts[i]!);
  return km;
}

export async function calculateFinalFare(tx: Tx, d: DeliveryRow, now: Date): Promise<FinalFareResult> {
  const [rule] = await tx.select().from(pricingRules).where(eq(pricingRules.id, d.pricingRuleId));
  const planned = d.distanceKm;
  const gps = await journeyKm(tx, d);
  const credible = gps != null && gps >= planned * MIN_COVERAGE;
  const km = credible ? Math.min(gps, Math.max(planned * MAX_FACTOR, planned + MAX_EXTRA_KM)) : planned;
  // Journey = pickup → arrival at the destination (arrival is "now" when the rider ends it; an
  // older job finalized later uses its recorded arrival time).
  const end = d.arrivedDropoffAt ?? now;
  const minutes = d.pickedUpAt
    ? Math.max(1, Math.ceil((end.getTime() - d.pickedUpAt.getTime()) / 60_000))
    : 0;
  const roundedKm = Math.round(km * 100) / 100;
  const split = computeFinalFare(rule!, roundedKm, minutes, d.commissionRate);
  return {
    fare: split.fare,
    commissionAmount: split.commissionAmount,
    riderEarning: split.riderEarning,
    actualDistanceKm: roundedKm,
    actualDurationMin: minutes,
    basis: credible ? 'gps' : 'estimate',
  };
}

/**
 * Stores the final fare on the delivery (inside the "end delivery" transaction). The booking
 * estimate is kept in `estimatedFare`. Runs once: a delivery already finalized is left alone.
 */
export async function finalizeFare(tx: Tx, d: DeliveryRow, now: Date): Promise<FinalFareResult | null> {
  if (d.fareFinalizedAt) return null;
  const f = await calculateFinalFare(tx, d, now);
  if (toSantim(f.fare) <= 0) return null;
  await tx
    .update(deliveries)
    .set({
      estimatedFare: d.fareAmount,
      fareAmount: f.fare,
      commissionAmount: f.commissionAmount,
      riderEarning: f.riderEarning,
      actualDistanceKm: f.actualDistanceKm,
      actualDurationMin: f.actualDurationMin,
      fareBasis: f.basis,
      fareFinalizedAt: now,
    })
    .where(eq(deliveries.id, d.id));
  return f;
}

export function finalFareView(d: DeliveryRow) {
  return d.fareFinalizedAt && d.actualDistanceKm != null && d.actualDurationMin != null
    ? {
        estimatedFare: d.estimatedFare ?? d.fareAmount,
        fare: d.fareAmount,
        actualDistanceKm: d.actualDistanceKm,
        actualDurationMin: d.actualDurationMin,
        basis: (d.fareBasis === 'gps' ? 'gps' : 'estimate') as 'gps' | 'estimate',
        finalizedAt: d.fareFinalizedAt.toISOString(),
      }
    : null;
}
