import { z } from 'zod';
import { PAYMENT_METHODS, USER_STATUSES, VEHICLE_TYPES } from './enums.ts';

const moneyInput = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter an amount like 150 or 150.50.');

export const PAYMENT_STATUSES = ['due', 'collected', 'waived', 'disputed'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Independent check of a payment, separate from the rider's own confirmation. */
export const PAYMENT_VERIFICATIONS = ['not_required', 'pending', 'verified', 'rejected'] as const;
export type PaymentVerification = (typeof PAYMENT_VERIFICATIONS)[number];

/**
 * Rider records the payment outcome at the destination.
 *  - `collected`: the rider received the money (a transfer needs its transaction ID).
 *  - `disputed`: the payer says they paid but the rider cannot see it; an admin follows up.
 */
export const recordPaymentSchema = z
  .object({
    method: z.enum(PAYMENT_METHODS),
    reference: z.string().trim().max(60).optional(),
    outcome: z.enum(['collected', 'disputed']).default('collected'),
    note: z.string().trim().max(300).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.method !== 'cash' && v.outcome === 'collected' && !v.reference) {
      ctx.addIssue({
        code: 'custom',
        path: ['reference'],
        message: 'Enter the transaction ID from the payment SMS.',
      });
    }
    if (v.outcome === 'disputed' && !v.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Say what happened.' });
    }
  });

/** The rider's "Done": payment is recorded and the parcel was handed over. */
export const completeDeliverySchema = z.object({
  handoverConfirmed: z.literal(true, { error: 'Confirm that you handed over the parcel.' }),
});

/** Admin independently checks a recorded Telebirr / CBE Birr payment against the statement. */
export const verifyPaymentSchema = z.object({
  decision: z.enum(['verify', 'reject']),
  note: z.string().trim().max(300).optional(),
});


/** Admin records money a rider handed over (reduces what they owe). */
export const settlementSchema = z.object({
  amount: moneyInput,
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(60).optional(),
  note: z.string().trim().max(200).optional(),
});

/** Admin resolves a due payment (e.g. a cancellation fee). */
export const resolvePaymentSchema = z.object({
  status: z.enum(['collected', 'waived']),
  method: z.enum(PAYMENT_METHODS).optional(),
  note: z.string().trim().max(200).optional(),
});

export const pricingRuleInputSchema = z
  .object({
    vehicleType: z.enum(VEHICLE_TYPES),
    baseFare: moneyInput,
    perKm: moneyInput,
    minimumFare: moneyInput,
    maxDistanceKm: z.number().positive().max(100).nullable(),
    commissionRate: z.number().min(0).max(0.5, 'Commission above 50% is not allowed.'),
    cancellationFeeAfterArrival: moneyInput,
    /** Per journey minute (pickup → drop-off) in the final fare; 0 = distance only. */
    perMinute: moneyInput.default('0'),
  })
  .refine((v) => Number(v.minimumFare) > 0, { path: ['minimumFare'], message: 'Must be above 0.' });
export type PricingRuleInput = z.infer<typeof pricingRuleInputSchema>;

export const adminCancelSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason.').max(200),
  /** Only applies after the rider reached the pickup. */
  chargeFee: z.boolean().default(false),
  /** The assigned rider caused the cancellation (no-show, misconduct): −3 points. */
  riderResponsible: z.boolean().default(false),
});

export const adminAssignSchema = z.object({ riderId: z.string().uuid() });

export const adminUserStatusSchema = z.object({
  status: z.enum(USER_STATUSES),
  reason: z.string().trim().min(3, 'Give a reason.').max(200),
});

export const paymentSummarySchema = z.object({
  status: z.enum(PAYMENT_STATUSES),
  method: z.enum(PAYMENT_METHODS).nullable(),
  amount: z.string(),
  collectedAt: z.string().nullable(),
});
export type PaymentSummary = z.infer<typeof paymentSummarySchema>;
