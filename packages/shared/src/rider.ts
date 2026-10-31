import { z } from 'zod';
import {
  DELIVERY_STATUSES,
  PARCEL_SIZES,
  PAYERS,
  PAYMENT_METHODS,
  RIDER_APPROVAL_STATUSES,
  VEHICLE_TYPES,
} from './enums.ts';

const money = z.string().regex(/^-?\d+\.\d{2}$/);

export const CONTACT_OUTCOMES = ['no_answer', 'busy', 'unreachable', 'answered'] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];

/** Business rule: a delivery may be marked failed after this many unanswered calls … */
export const FAIL_MIN_ATTEMPTS = 3;
/** … spread over at least this many minutes. */
export const FAIL_MIN_MINUTES = 10;

// ── Application ──────────────────────────────────────────────────────────────

export const riderApplySchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name.').max(80),
    vehicleType: z.enum(VEHICLE_TYPES),
    plateNumber: z
      .string()
      .trim()
      .toUpperCase()
      .max(15)
      .regex(/^[A-Z0-9-]*$/, 'Use letters, numbers and dashes only.')
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.vehicleType === 'motorcycle' && !v.plateNumber) {
      ctx.addIssue({
        code: 'custom',
        path: ['plateNumber'],
        message: 'Motorcycles need a plate number.',
      });
    }
  });
export type RiderApplyInput = z.input<typeof riderApplySchema>;

export const riderProfileSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().nullable(),
  phone: z.string(),
  vehicleType: z.enum(VEHICLE_TYPES),
  plateNumber: z.string().nullable(),
  approvalStatus: z.enum(RIDER_APPROVAL_STATUSES),
  rejectionReason: z.string().nullable(),
  isOnline: z.boolean(),
  locationUpdatedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type RiderProfile = z.infer<typeof riderProfileSchema>;

// ── Live status ──────────────────────────────────────────────────────────────

export const riderStatusSchema = z.object({ online: z.boolean() });

export const riderLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(10_000).optional(),
});

// ── Offers ───────────────────────────────────────────────────────────────────

const areaSchema = z.object({
  address: z.string(),
  subCity: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
});

export const riderOfferSchema = z.object({
  id: z.string().uuid(),
  expiresAt: z.string(),
  secondsLeft: z.number().int(),
  toPickupKm: z.number(),
  delivery: z.object({
    code: z.string(),
    vehicleType: z.enum(VEHICLE_TYPES),
    distanceKm: z.number(),
    fare: money,
    riderEarning: money,
    payer: z.enum(PAYERS),
    parcel: z.object({ description: z.string(), size: z.enum(PARCEL_SIZES) }),
    // Areas only: contact details are shared after the rider accepts.
    pickup: areaSchema,
    dropoff: areaSchema,
  }),
});
export type RiderOffer = z.infer<typeof riderOfferSchema>;

// ── Active job ───────────────────────────────────────────────────────────────

const jobStopSchema = areaSchema.extend({
  contactName: z.string(),
  contactPhone: z.string(),
  notes: z.string(),
});

export const riderJobSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: z.enum(DELIVERY_STATUSES),
  vehicleType: z.enum(VEHICLE_TYPES),
  distanceKm: z.number(),
  fare: money,
  riderEarning: money,
  payer: z.enum(PAYERS),
  preferredPaymentMethod: z.enum(PAYMENT_METHODS),
  parcel: z.object({ description: z.string(), size: z.enum(PARCEL_SIZES) }),
  pickup: jobStopSchema,
  dropoff: jobStopSchema,
  contactAttempts: z.array(z.object({ at: z.string(), outcome: z.enum(CONTACT_OUTCOMES) })),
  /** When the failed-delivery rule is satisfied; null while there are too few attempts. */
  canFailAt: z.string().nullable(),
  /** Fare payment recorded by the rider; required before "delivered". */
  farePayment: z
    .object({ method: z.enum(PAYMENT_METHODS), reference: z.string().nullable(), at: z.string() })
    .nullable(),
  assignedAt: z.string().nullable(),
});
export type RiderJob = z.infer<typeof riderJobSchema>;

export const riderHomeSchema = z.object({
  profile: riderProfileSchema.nullable(),
  offer: riderOfferSchema.nullable(),
  job: riderJobSchema.nullable(),
});
export type RiderHome = z.infer<typeof riderHomeSchema>;

export const RIDER_STEPS = [
  'arrived_pickup',
  'picked_up',
  'arrived_dropoff',
  'delivered',
  'returned',
] as const;
export const riderTransitionSchema = z.object({
  to: z.enum(RIDER_STEPS),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

export const contactAttemptSchema = z.object({ outcome: z.enum(CONTACT_OUTCOMES) });

// ── Admin ────────────────────────────────────────────────────────────────────

export const adminRiderDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'suspend', 'reinstate']),
  reason: z.string().trim().max(200).optional(),
});
