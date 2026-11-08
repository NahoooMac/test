import { z } from 'zod';
import {
  ACTOR_ROLES,
  DELIVERY_STATUSES,
  PARCEL_SIZES,
  PAYERS,
  PAYMENT_METHODS,
  VEHICLE_TYPES,
} from './enums.ts';
import { isInAddis } from './geo.ts';
import { normalizeEthiopianPhone } from './phone.ts';

const money = z.string().regex(/^-?\d+\.\d{2}$/);

export const latLngSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .refine(isInAddis, { message: 'This location is outside our Addis Ababa service area.' });

const ethiopianPhone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const r = normalizeEthiopianPhone(v);
    if (!r.ok) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid Ethiopian mobile number.' });
      return z.NEVER;
    }
    return r.e164;
  });

// ── Geo search ───────────────────────────────────────────────────────────────

export const placeSchema = z.object({
  name: z.string(),
  description: z.string(),
  lat: z.number(),
  lng: z.number(),
  subCity: z.string().nullable(),
  inServiceArea: z.boolean(),
});
export type Place = z.infer<typeof placeSchema>;

/** Autocomplete result: named, but without coordinates until resolved via /geo/resolve. */
export const placeSuggestionSchema = z.object({
  ref: z.string(),
  name: z.string(),
  description: z.string(),
  subCity: z.string().nullable(),
});
export type PlaceSuggestion = z.infer<typeof placeSuggestionSchema>;

// ── Quote ────────────────────────────────────────────────────────────────────

export const quoteRequestSchema = z.object({
  pickup: latLngSchema,
  dropoff: latLngSchema,
});
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

export const quoteOptionSchema = z.object({
  vehicleType: z.enum(VEHICLE_TYPES),
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
  fare: money,
  etaMin: z.number().int(),
  /** Charged only if the customer cancels after the rider has arrived at pickup. */
  cancellationFeeAfterArrival: money,
});
export type QuoteOption = z.infer<typeof quoteOptionSchema>;

export const quoteSchema = z.object({
  distanceKm: z.number(),
  /** 'estimate' = straight line × road factor; 'route' = road routing service. */
  distanceSource: z.enum(['estimate', 'route']),
  options: z.array(quoteOptionSchema),
});
export type Quote = z.infer<typeof quoteSchema>;

// ── Create ───────────────────────────────────────────────────────────────────

export const stopInputSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  address: z.string().trim().min(2, 'Choose a location.').max(300),
  subCity: z.string().max(60).nullable().optional(),
  contactName: z.string().trim().min(2, 'Enter a name.').max(80),
  contactPhone: ethiopianPhone,
  notes: z.string().trim().max(300).optional().default(''),
});

export const createDeliverySchema = z
  .object({
    pickup: stopInputSchema,
    dropoff: stopInputSchema,
    vehicleType: z.enum(VEHICLE_TYPES),
    payer: z.enum(PAYERS),
    preferredPaymentMethod: z.enum(PAYMENT_METHODS),
    parcel: z.object({
      description: z.string().trim().min(2, 'Describe the parcel.').max(200),
      size: z.enum(PARCEL_SIZES),
    }),
  })
  .superRefine((v, ctx) => {
    for (const key of ['pickup', 'dropoff'] as const) {
      if (!isInAddis(v[key])) {
        ctx.addIssue({
          code: 'custom',
          path: [key, 'lat'],
          message: 'This location is outside our Addis Ababa service area.',
        });
      }
    }
  });
export type CreateDeliveryInput = z.input<typeof createDeliverySchema>;

// ── Read models ──────────────────────────────────────────────────────────────

export const stopSchema = z.object({
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  subCity: z.string().nullable(),
  contactName: z.string(),
  contactPhone: z.string(),
  notes: z.string(),
});
export type Stop = z.infer<typeof stopSchema>;

export const deliveryEventSchema = z.object({
  id: z.string(),
  fromStatus: z.enum(DELIVERY_STATUSES).nullable(),
  toStatus: z.enum(DELIVERY_STATUSES),
  actorRole: z.enum(ACTOR_ROLES),
  note: z.string().nullable(),
  at: z.string(),
});
export type DeliveryEvent = z.infer<typeof deliveryEventSchema>;

const moneyStr = z.string().regex(/^-?\d+\.\d{2}$/);

/** The final fare, set when the rider ends the delivery at the destination. */
export const finalFareSchema = z.object({
  estimatedFare: moneyStr,
  fare: moneyStr,
  actualDistanceKm: z.number(),
  actualDurationMin: z.number().int(),
  /** 'gps' = recorded route; 'estimate' = not enough GPS, the booking distance was used. */
  basis: z.enum(['gps', 'estimate']),
  finalizedAt: z.string(),
});
export type FinalFare = z.infer<typeof finalFareSchema>;

/** A fare payment as the payer and rider see it. */
export const farePaymentViewSchema = z.object({
  status: z.enum(['due', 'collected', 'waived', 'disputed']),
  method: z.enum(PAYMENT_METHODS).nullable(),
  /** Independent check (mobile transfers); null when nothing is recorded yet. */
  verification: z.enum(['not_required', 'pending', 'verified', 'rejected']).nullable(),
});
export type FarePaymentView = z.infer<typeof farePaymentViewSchema>;

export const deliverySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: z.enum(DELIVERY_STATUSES),
  vehicleType: z.enum(VEHICLE_TYPES),
  payer: z.enum(PAYERS),
  preferredPaymentMethod: z.enum(PAYMENT_METHODS),
  pickup: stopSchema,
  dropoff: stopSchema,
  parcel: z.object({ description: z.string(), size: z.enum(PARCEL_SIZES) }),
  distanceKm: z.number(),
  etaMin: z.number().int(),
  fare: money,
  cancellationFee: money,
  /** Fee the customer would pay if they cancelled now; null when cancelling is not possible. */
  cancelFeeNow: money.nullable(),
  rider: z
    .object({
      name: z.string().nullable(),
      phone: z.string(),
      vehicleType: z.enum(VEHICLE_TYPES),
      plate: z.string().nullable(),
      /** The rider's profile photo, so the customer can recognise them. */
      photoUrl: z.string().nullable(),
    })
    .nullable(),
  /** How the fare was paid, once the rider recorded it. */
  farePayment: farePaymentViewSchema.nullable(),
  /** Set once the rider reached the destination and the final price was calculated. */
  finalFare: finalFareSchema.nullable(),
  /** Last known rider position while the job is in progress; null otherwise. */
  riderLocation: z.object({ lat: z.number(), lng: z.number(), at: z.string() }).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  events: z.array(deliveryEventSchema),
});
export type Delivery = z.infer<typeof deliverySchema>;

export const deliverySummarySchema = deliverySchema.omit({ events: true });
export type DeliverySummary = z.infer<typeof deliverySummarySchema>;

export const cancelDeliverySchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

// ── Public tracking (shareable link, no sign-in) ─────────────────────────────

/** Deliberately limited: no sender/receiver phone numbers, no prices. */
export const publicTrackingSchema = z.object({
  code: z.string(),
  status: z.enum(DELIVERY_STATUSES),
  vehicleType: z.enum(VEHICLE_TYPES),
  etaMin: z.number().int(),
  pickup: z.object({
    address: z.string(),
    subCity: z.string().nullable(),
    lat: z.number(),
    lng: z.number(),
  }),
  dropoff: z.object({
    address: z.string(),
    subCity: z.string().nullable(),
    lat: z.number(),
    lng: z.number(),
  }),
  rider: z
    .object({
      firstName: z.string().nullable(),
      vehicleType: z.enum(VEHICLE_TYPES),
      plate: z.string().nullable(),
      /** Only while the rider is on the way, so the receiver can call. */
      phone: z.string().nullable(),
      /** Same rule as the phone number: only while the rider is on the job. */
      photoUrl: z.string().nullable(),
    })
    .nullable(),
  riderLocation: z.object({ lat: z.number(), lng: z.number(), at: z.string() }).nullable(),
  /**
   * Final price for whoever pays, once the rider reached the destination. Shown on this public
   * page so a receiver without the app can see it from the SMS link. No names or phone numbers.
   */
  payment: z
    .object({
      payer: z.enum(PAYERS),
      finalFare: finalFareSchema,
      status: z.enum(['due', 'collected', 'waived', 'disputed']),
    })
    .nullable(),
  timeline: z.array(z.object({ status: z.enum(DELIVERY_STATUSES), at: z.string() })),
  updatedAt: z.string(),
});
export type PublicTracking = z.infer<typeof publicTrackingSchema>;
