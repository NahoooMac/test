import { z } from 'zod';
import { SUB_CITIES, type VehicleType } from './enums.ts';
import { DEFAULT_LIVENESS, type LivenessThresholds } from './kyc.ts';
import { haversineKm, isInAddis, type LatLng } from './geo.ts';

// ── Service areas ────────────────────────────────────────────────────────────

export const SUB_CITY_SLUGS = SUB_CITIES.map((s) => s.slug) as [string, ...string[]];

/**
 * Approximate centre of each sub-city. Used only when a pickup's sub-city is unknown, so every
 * delivery still has exactly one area for matching (the nearest centre), decided the same way
 * every time.
 */
export const SUB_CITY_CENTRES: Record<string, LatLng> = {
  bole: { lat: 8.995, lng: 38.8 },
  kirkos: { lat: 9.01, lng: 38.76 },
  yeka: { lat: 9.04, lng: 38.81 },
  'nifas-silk-lafto': { lat: 8.96, lng: 38.74 },
  arada: { lat: 9.035, lng: 38.75 },
  'addis-ketema': { lat: 9.03, lng: 38.725 },
  lideta: { lat: 9.01, lng: 38.735 },
  'kolfe-keranio': { lat: 9.005, lng: 38.69 },
  gullele: { lat: 9.065, lng: 38.735 },
  'akaki-kality': { lat: 8.89, lng: 38.785 },
  'lemi-kura': { lat: 9.02, lng: 38.88 },
};

/** The matching area of a pickup: the geocoder's sub-city, else the nearest sub-city centre. */
export function pickupArea(subCity: string | null | undefined, at: LatLng): string {
  if (subCity && subCity in SUB_CITY_CENTRES) return subCity;
  let best = SUB_CITY_SLUGS[0];
  let bestKm = Infinity;
  for (const [slug, c] of Object.entries(SUB_CITY_CENTRES)) {
    const km = haversineKm(at, c);
    if (km < bestKm) {
      bestKm = km;
      best = slug;
    }
  }
  return best;
}

export const HOME_RADIUS_MIN_KM = 1;
export const HOME_RADIUS_MAX_KM = 30;

export const riderPreferencesSchema = z.object({
  serviceAreas: z
    .array(z.enum(SUB_CITY_SLUGS))
    .max(SUB_CITY_SLUGS.length)
    .transform((a) => [...new Set(a)]),
  home: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      radiusKm: z.number().min(HOME_RADIUS_MIN_KM).max(HOME_RADIUS_MAX_KM),
    })
    .refine((h) => isInAddis(h), 'Choose a place inside Addis Ababa.')
    .nullable(),
});
export type RiderPreferencesInput = z.input<typeof riderPreferencesSchema>;

export interface RiderPreferences {
  /** Empty = not chosen yet: the rider is matched in every area. */
  serviceAreas: string[];
  home: { lat: number; lng: number; radiusKm: number } | null;
}

// ── Offer pool ───────────────────────────────────────────────────────────────

/** What a rider sees before claiming: no customer names or phone numbers. */
export interface PoolOffer {
  deliveryId: string;
  code: string;
  vehicleType: VehicleType;
  area: string;
  pickup: { address: string; subCity: string | null; lat: number; lng: number; notes: string };
  dropoff: { address: string; subCity: string | null; lat: number; lng: number; notes: string };
  parcel: { description: string; size: string };
  distanceKm: number;
  distanceSource: string;
  etaMin: number;
  toPickupKm: number | null;
  fare: string;
  commission: string;
  riderEarning: string;
  payer: 'sender' | 'receiver';
  availableSince: string;
  nearHome: boolean;
}

export interface RiderPool {
  offers: PoolOffer[];
  wallet: WalletEligibility;
  /** Why the list may be empty or claims refused (not approved, busy, …). */
  blockedReason: string | null;
}

// ── Wallet ───────────────────────────────────────────────────────────────────

export interface WalletEligibility {
  balance: string;
  minBalance: string;
  debtLimit: string;
  /** Meets the minimum balance (a specific job also needs room under the debt limit). */
  canTakeWork: boolean;
  issue: 'below_minimum' | 'at_debt_limit' | null;
}

export interface WalletEntry {
  id: string;
  type: 'commission' | 'settlement' | 'adjustment';
  /** Signed from the rider's point of view: + credit, − debit. */
  amount: string;
  note: string | null;
  method: string | null;
  reference: string | null;
  deliveryCode: string | null;
  createdAt: string;
}

export interface WalletTopup {
  id: string;
  amount: string;
  method: 'telebirr' | 'cbe_birr';
  reference: string;
  status: 'pending' | 'verified' | 'rejected';
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface RiderWallet extends WalletEligibility {
  entries: WalletEntry[];
  topups: WalletTopup[];
}

export const topupRequestSchema = z.object({
  amount: z
    .string()
    .regex(/^\d{1,6}(\.\d{1,2})?$/, 'Enter an amount like 200 or 150.50.')
    .refine((v) => Number(v) >= 10 && Number(v) <= 100_000, 'Between 10 and 100,000 ETB.'),
  method: z.enum(['telebirr', 'cbe_birr']),
  reference: z
    .string()
    .trim()
    .min(6, 'Enter the transaction ID from the payment SMS.')
    .max(40)
    .regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes only.'),
});

// ── Points and ratings ───────────────────────────────────────────────────────

export const POINTS_START = 50;
export const POINTS_COMPLETION = 1;
export const POINTS_RIDER_CANCELLATION = -3;

export interface PointsEntry {
  id: string;
  type: 'initial' | 'completion' | 'rider_cancellation' | 'adjustment';
  delta: number;
  reason: string;
  deliveryCode: string | null;
  createdAt: string;
}

export interface RiderStanding {
  points: number;
  pointsHistory: PointsEntry[];
  rating: { average: number | null; count: number };
}

export const ratingSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(300).optional(),
});

export const reportRatingSchema = z.object({
  reason: z.string().trim().min(5, 'Say what is wrong with this rating.').max(300),
});

export interface MyRating {
  stars: number;
  comment: string | null;
  createdAt: string;
}

// ── Route history ────────────────────────────────────────────────────────────

export const ROUTE_BATCH_MAX = 500;

export const routePointsSchema = z.object({
  points: z
    .array(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        recordedAt: z.string().datetime(),
        accuracyM: z.number().min(0).max(100_000).optional(),
      }),
    )
    .min(1)
    .max(ROUTE_BATCH_MAX),
});

export interface RoutePoint {
  lat: number;
  lng: number;
  at: string;
  stage: 'to_pickup' | 'to_dropoff' | 'returning';
  accuracyM: number | null;
}

export interface DeliveryHistoryRow {
  id: string;
  code: string;
  status: string;
  vehicleType: VehicleType;
  pickupAddress: string;
  dropoffAddress: string;
  fare: string;
  commission: string | null;
  riderEarning: string;
  cancellationFee: string;
  createdAt: string;
  finishedAt: string | null;
}

export interface DeliveryHistoryDetail extends DeliveryHistoryRow {
  pickup: { address: string; subCity: string | null; lat: number; lng: number };
  dropoff: { address: string; subCity: string | null; lat: number; lng: number };
  distanceKm: number;
  distanceSource: string;
  /** Commission actually deducted from the wallet (null if none was). */
  commissionDeducted: string | null;
  cancelReason: string | null;
  cancelledBy: string | null;
  timeline: Array<{ status: string; at: string; actor: string }>;
  route: RoutePoint[];
  /** Recorded GPS distance (sum of segments between kept points), or null without enough points. */
  recordedKm: number | null;
  durationMin: number | null;
  rating: { stars: number; comment: string | null } | null;
}

// ── Nearby riders (customer booking map) ─────────────────────────────────────

/** An approximate, anonymous rider position for the booking map (see geo/nearbyRiders.ts). */
export interface NearbyRider {
  /** Opaque marker key, stable for about an hour; not the rider's id. */
  key: string;
  vehicleType: VehicleType;
  lat: number;
  lng: number;
  /** Direction for the icon (radians, 0 = north). */
  heading: number;
}

// ── Admin notifications ──────────────────────────────────────────────────────

export interface AdminNotification {
  id: string;
  kind: 'delivery' | 'payment' | 'topup' | 'kyc' | 'rating';
  title: string;
  body: string;
  at: string;
  /** Where the admin goes to see it. */
  link: string;
  /** Waiting for an admin (vs. a plain update). */
  needsAction: boolean;
}

export interface AdminNotifications {
  items: AdminNotification[];
  actionCount: number;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface MatchingWeights {
  /** Score lost per km between rider and pickup. */
  distancePerKm: number;
  /** Bonus when the pickup is within the rider's home radius. */
  homeBonus: number;
  /** Per star above/below the neutral 4.5 (Bayesian average). */
  ratingPerStar: number;
  /** Per point above/below the starting 50 (capped at ±50). */
  pointsPerPoint: number;
  /** Per hour since the rider's last job (capped at 8 h): fair access for idle/new riders. */
  idlePerHour: number;
  /** Lost per rider-responsible cancellation in the last 30 days. */
  cancelPenalty: number;
}

export interface PlatformSettings {
  walletMinBalance: string;
  walletDebtLimit: string;
  matching: MatchingWeights;
  routeRetentionDays: number;
  /** Rider KYC face-liveness acceptance thresholds. */
  liveness: LivenessThresholds;
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  walletMinBalance: '0.00',
  walletDebtLimit: '50.00',
  matching: {
    distancePerKm: 10,
    homeBonus: 8,
    ratingPerStar: 6,
    pointsPerPoint: 0.2,
    idlePerHour: 2,
    cancelPenalty: 4,
  },
  routeRetentionDays: 180,
  liveness: DEFAULT_LIVENESS,
};

const amount = z.string().regex(/^\d{1,6}(\.\d{1,2})?$/, 'Enter an amount like 50 or 50.00.');

export const settingsUpdateSchema = z.object({
  walletMinBalance: amount.optional(),
  walletDebtLimit: amount.optional(),
  matching: z
    .object({
      distancePerKm: z.number().min(0).max(100),
      homeBonus: z.number().min(0).max(100),
      ratingPerStar: z.number().min(0).max(100),
      pointsPerPoint: z.number().min(0).max(10),
      idlePerHour: z.number().min(0).max(100),
      cancelPenalty: z.number().min(0).max(100),
    })
    .partial()
    .optional(),
  routeRetentionDays: z.number().int().min(30).max(3650).optional(),
  liveness: z
    .object({
      turnYawDeg: z.number().min(10).max(45),
      centerYawDeg: z.number().min(3).max(20),
      maxPitchDeg: z.number().min(10).max(45),
      holdMs: z.number().int().min(300).max(3000),
      minFaceArea: z.number().min(0.01).max(0.5),
      maxFaceShift: z.number().min(0.05).max(0.6),
      sessionSeconds: z.number().int().min(60).max(600),
    })
    .partial()
    .optional(),
  reason: z.string().trim().min(3, 'Say why you are changing this.').max(200),
});

export const pointsAdjustSchema = z.object({
  delta: z
    .number()
    .int()
    .refine((v) => v !== 0 && Math.abs(v) <= 100, 'Between −100 and 100, not 0.'),
  reason: z.string().trim().min(5, 'Explain the correction.').max(300),
  deliveryCode: z.string().trim().max(12).optional(),
});

export const walletAdjustSchema = z.object({
  /** Signed from the rider's point of view: + credit, − debit. */
  amount: z
    .string()
    .regex(/^-?\d{1,6}(\.\d{1,2})?$/, 'Like 50 or -25.50.')
    .refine((v) => Number(v) !== 0, 'Not 0.'),
  reason: z.string().trim().min(5, 'Explain the adjustment.').max(300),
});

export const topupReviewSchema = z.object({
  decision: z.enum(['verify', 'reject']),
  note: z.string().trim().max(300).optional(),
});

export const ratingReviewSchema = z.object({
  decision: z.enum(['keep', 'remove']),
  note: z.string().trim().min(3, 'Record why.').max(300),
});
