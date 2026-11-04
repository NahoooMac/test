// Pure pricing functions. All money maths is in integer santim (1 ETB = 100 santim).
import { fromSantim, haversineKm, toSantim, type LatLng, type VehicleType } from '@dp/shared';

export interface PricingRule {
  id: string;
  vehicleType: VehicleType;
  baseFare: string;
  perKm: string;
  minimumFare: string;
  maxDistanceKm: number | null;
  commissionRate: string;
  cancellationFeeAfterArrival: string;
  /** Per journey minute in the final fare (0 = distance only). */
  perMinute: string;
}

export interface FareBreakdown {
  fare: string;
  commissionRate: string;
  commissionAmount: string;
  riderEarning: string;
}

/**
 * Straight-line distance × road factor. Used until a Yandex routing key is available; the
 * result is labelled 'estimate' everywhere it is shown.
 */
export const ROAD_FACTOR = 1.3;

export function estimateRoadKm(a: LatLng, b: LatLng): number {
  const km = haversineKm(a, b) * ROAD_FACTOR;
  return Math.max(0.3, Math.round(km * 100) / 100);
}

/** Average door-to-door speeds in Addis traffic, plus time to reach the pickup. */
const SPEED_KMH: Record<VehicleType, number> = { motorcycle: 22, bicycle: 13, scooter: 18 };
const PICKUP_BUFFER_MIN = 8;

export function etaMinutes(km: number, vehicle: VehicleType): number {
  return Math.ceil(PICKUP_BUFFER_MIN + (km / SPEED_KMH[vehicle]) * 60);
}

/** Fares are rounded up to the next 5 ETB, which is easier to settle in cash. */
const ROUND_TO_SANTIM = 500;

export function computeFare(rule: PricingRule, km: number): FareBreakdown {
  const raw = toSantim(rule.baseFare) + Math.round(toSantim(rule.perKm) * km);
  const floored = Math.max(raw, toSantim(rule.minimumFare));
  const fare = Math.ceil(floored / ROUND_TO_SANTIM) * ROUND_TO_SANTIM;
  const basisPoints = Math.round(Number(rule.commissionRate) * 10_000);
  const commission = Math.round((fare * basisPoints) / 10_000);
  return {
    fare: fromSantim(fare),
    commissionRate: rule.commissionRate,
    commissionAmount: fromSantim(commission),
    riderEarning: fromSantim(fare - commission),
  };
}

/**
 * Final fare at the destination: the booking's own rule applied to the distance actually
 * travelled and the journey time, with the commission at the rate recorded on the delivery.
 */
export function computeFinalFare(
  rule: Pick<PricingRule, 'baseFare' | 'perKm' | 'minimumFare' | 'perMinute'>,
  km: number,
  minutes: number,
  commissionRate: string,
): FareBreakdown {
  const raw =
    toSantim(rule.baseFare) +
    Math.round(toSantim(rule.perKm) * km) +
    Math.round(toSantim(rule.perMinute) * minutes);
  const floored = Math.max(raw, toSantim(rule.minimumFare));
  const fare = Math.ceil(floored / ROUND_TO_SANTIM) * ROUND_TO_SANTIM;
  const basisPoints = Math.round(Number(commissionRate) * 10_000);
  const commission = Math.round((fare * basisPoints) / 10_000);
  return {
    fare: fromSantim(fare),
    commissionRate,
    commissionAmount: fromSantim(commission),
    riderEarning: fromSantim(fare - commission),
  };
}

export function unavailableReason(rule: PricingRule, km: number): string | null {
  if (rule.maxDistanceKm != null && km > rule.maxDistanceKm) {
    return `Bicycle deliveries are limited to ${rule.maxDistanceKm} km.`;
  }
  return null;
}
