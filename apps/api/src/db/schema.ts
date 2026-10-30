// Database schema. Money is NUMERIC(12,2) (decimal strings in JS); coordinates are NUMERIC(9,6).
// Invariants that matter for money and dispatch are enforced here, not only in application code.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ACTIVE_RIDER_STATUSES,
  ACTOR_ROLES,
  DELIVERY_STATUSES,
  LANGUAGES,
  PARCEL_SIZES,
  PAYERS,
  PAYMENT_METHODS,
  RIDER_APPROVAL_STATUSES,
  USER_ROLES,
  USER_STATUSES,
  VEHICLE_TYPES,
} from '@dp/shared';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const userRole = pgEnum('user_role', USER_ROLES);
export const userStatus = pgEnum('user_status', USER_STATUSES);
export const otpPurpose = pgEnum('otp_purpose', ['login']);
export const otpCloseReason = pgEnum('otp_close_reason', [
  'consumed',
  'expired',
  'max_attempts',
  'superseded',
]);
export const smsStatus = pgEnum('sms_status', [
  'queued',
  'sent',
  'failed',
  'delivered',
  'undelivered',
]);
export const lockoutScope = pgEnum('lockout_scope', ['phone', 'ip']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phoneE164: text('phone_e164').notNull(),
    fullName: text('full_name'),
    role: userRole('role').notNull().default('customer'),
    status: userStatus('status').notNull().default('active'),
    preferredLanguage: text('preferred_language', { enum: LANGUAGES }).notNull().default('en'),
    phoneVerifiedAt: tstz('phone_verified_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_phone_e164_key').on(t.phoneE164),
    check('users_phone_e164_format', sql`${t.phoneE164} ~ '^\\+251[79][0-9]{8}$'`),
    check('users_preferred_language_check', sql`${t.preferredLanguage} in ('en', 'am')`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // sha256 of the cookie token; the raw token is never stored.
    tokenHash: text('token_hash').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
    expiresAt: tstz('expires_at').notNull(),
    absoluteExpiresAt: tstz('absolute_expires_at').notNull(),
    revokedAt: tstz('revoked_at'),
    revokeReason: text('revoke_reason'),
    userAgent: text('user_agent'),
    ip: text('ip'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
    check('sessions_expiry_order', sql`${t.expiresAt} <= ${t.absoluteExpiresAt}`),
  ],
);

export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phoneE164: text('phone_e164').notNull(),
    purpose: otpPurpose('purpose').notNull().default('login'),
    // HMAC-SHA256(server secret, challenge id + code); the code itself is never stored.
    codeHash: text('code_hash').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    attempts: smallint('attempts').notNull().default(0),
    maxAttempts: smallint('max_attempts').notNull().default(5),
    sendCount: smallint('send_count').notNull().default(0),
    lastSentAt: tstz('last_sent_at'),
    closedAt: tstz('closed_at'),
    closeReason: otpCloseReason('close_reason'),
    requestIp: text('request_ip'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // At most one open challenge per phone and purpose.
    uniqueIndex('otp_challenges_one_open_per_phone')
      .on(t.phoneE164, t.purpose)
      .where(sql`${t.closedAt} is null`),
    index('otp_challenges_phone_created_idx').on(t.phoneE164, t.createdAt),
    check(
      'otp_challenges_attempts_range',
      sql`${t.attempts} >= 0 and ${t.attempts} <= ${t.maxAttempts}`,
    ),
    check(
      'otp_challenges_close_consistency',
      sql`(${t.closedAt} is null) = (${t.closeReason} is null)`,
    ),
  ],
);

export const smsMessages = pgTable(
  'sms_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    phoneE164: text('phone_e164').notNull(),
    purpose: text('purpose').notNull(),
    challengeId: uuid('challenge_id').references(() => otpChallenges.id, { onDelete: 'set null' }),
    providerMessageId: text('provider_message_id'),
    status: smsStatus('status').notNull().default('queued'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    costAmount: numeric('cost_amount', { precision: 12, scale: 2 }),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('sms_messages_phone_created_idx').on(t.phoneE164, t.createdAt),
    index('sms_messages_created_idx').on(t.createdAt),
    uniqueIndex('sms_messages_provider_message_key')
      .on(t.provider, t.providerMessageId)
      .where(sql`${t.providerMessageId} is not null`),
  ],
);

/** Fixed-window counters, e.g. key `otp:phone:+2519…` with a 15-minute window. */
export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    key: text('key').notNull(),
    windowStart: tstz('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    index('rate_limit_buckets_window_idx').on(t.windowStart),
  ],
);

export const authLockouts = pgTable(
  'auth_lockouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: lockoutScope('scope').notNull(),
    subject: text('subject').notNull(),
    lockedUntil: tstz('locked_until').notNull(),
    reason: text('reason').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('auth_lockouts_lookup_idx').on(t.scope, t.subject, t.lockedUntil)],
);

export const serviceAreas = pgTable('service_areas', {
  slug: text('slug').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameAm: text('name_am').notNull(),
  active: boolean('active').notNull().default(true),
  sortOrder: smallint('sort_order').notNull(),
});

// ── Phase 4: riders, pricing, deliveries ────────────────────────────────────

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });
const coord = (name: string) => numeric(name, { precision: 9, scale: 6, mode: 'number' });
const activeStatusList = sql.raw(ACTIVE_RIDER_STATUSES.map((s) => `'${s}'`).join(', '));

export const vehicleType = pgEnum('vehicle_type', VEHICLE_TYPES);
export const deliveryStatus = pgEnum('delivery_status', DELIVERY_STATUSES);
export const payer = pgEnum('payer', PAYERS);
export const paymentMethod = pgEnum('payment_method', PAYMENT_METHODS);
export const parcelSize = pgEnum('parcel_size', PARCEL_SIZES);
export const riderApproval = pgEnum('rider_approval', RIDER_APPROVAL_STATUSES);
export const actorRole = pgEnum('actor_role', ACTOR_ROLES);

export const riders = pgTable(
  'riders',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'restrict' }),
    vehicleType: vehicleType('vehicle_type').notNull(),
    plateNumber: text('plate_number'),
    approvalStatus: riderApproval('approval_status').notNull().default('pending'),
    isOnline: boolean('is_online').notNull().default(false),
    currentLat: coord('current_lat'),
    currentLng: coord('current_lng'),
    locationUpdatedAt: tstz('location_updated_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'riders_motorcycle_needs_plate',
      sql`${t.vehicleType} <> 'motorcycle' or ${t.plateNumber} is not null`,
    ),
    index('riders_dispatch_idx').on(t.approvalStatus, t.isOnline, t.vehicleType),
  ],
);

/** Versioned rates. Deliveries reference the rule they were priced with; history is never rewritten. */
export const pricingRules = pgTable(
  'pricing_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleType: vehicleType('vehicle_type').notNull(),
    baseFare: money('base_fare').notNull(),
    perKm: money('per_km').notNull(),
    minimumFare: money('minimum_fare').notNull(),
    maxDistanceKm: numeric('max_distance_km', { precision: 6, scale: 2, mode: 'number' }),
    commissionRate: numeric('commission_rate', { precision: 5, scale: 4 }).notNull(),
    cancellationFeeAfterArrival: money('cancellation_fee_after_arrival').notNull(),
    effectiveFrom: tstz('effective_from').notNull().defaultNow(),
    effectiveTo: tstz('effective_to'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pricing_rules_one_current_per_vehicle')
      .on(t.vehicleType)
      .where(sql`${t.effectiveTo} is null`),
    check(
      'pricing_rules_commission_range',
      sql`${t.commissionRate} >= 0 and ${t.commissionRate} < 1`,
    ),
    check(
      'pricing_rules_non_negative',
      sql`${t.baseFare} >= 0 and ${t.perKm} >= 0 and ${t.minimumFare} > 0 and ${t.cancellationFeeAfterArrival} >= 0`,
    ),
  ],
);

export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicCode: text('public_code').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    riderId: uuid('rider_id').references(() => riders.userId, { onDelete: 'restrict' }),
    vehicleType: vehicleType('vehicle_type').notNull(),
    status: deliveryStatus('status').notNull().default('requested'),
    payer: payer('payer').notNull(),
    preferredPaymentMethod: paymentMethod('preferred_payment_method').notNull(),

    pickupAddress: text('pickup_address').notNull(),
    pickupLat: coord('pickup_lat').notNull(),
    pickupLng: coord('pickup_lng').notNull(),
    pickupSubCity: text('pickup_sub_city'),
    pickupContactName: text('pickup_contact_name').notNull(),
    pickupContactPhone: text('pickup_contact_phone').notNull(),
    pickupNotes: text('pickup_notes').notNull().default(''),

    dropoffAddress: text('dropoff_address').notNull(),
    dropoffLat: coord('dropoff_lat').notNull(),
    dropoffLng: coord('dropoff_lng').notNull(),
    dropoffSubCity: text('dropoff_sub_city'),
    dropoffContactName: text('dropoff_contact_name').notNull(),
    dropoffContactPhone: text('dropoff_contact_phone').notNull(),
    dropoffNotes: text('dropoff_notes').notNull().default(''),

    parcelDescription: text('parcel_description').notNull(),
    parcelSize: parcelSize('parcel_size').notNull(),

    distanceKm: numeric('distance_km', { precision: 8, scale: 2, mode: 'number' }).notNull(),
    distanceSource: text('distance_source').notNull(),
    etaMin: integer('eta_min').notNull(),

    pricingRuleId: uuid('pricing_rule_id')
      .notNull()
      .references(() => pricingRules.id),
    fareAmount: money('fare_amount').notNull(),
    commissionRate: numeric('commission_rate', { precision: 5, scale: 4 }).notNull(),
    commissionAmount: money('commission_amount').notNull(),
    riderEarning: money('rider_earning').notNull(),
    cancellationFee: money('cancellation_fee').notNull().default('0.00'),
    cancelledBy: actorRole('cancelled_by'),
    cancelReason: text('cancel_reason'),

    assignedAt: tstz('assigned_at'),
    arrivedPickupAt: tstz('arrived_pickup_at'),
    pickedUpAt: tstz('picked_up_at'),
    arrivedDropoffAt: tstz('arrived_dropoff_at'),
    deliveredAt: tstz('delivered_at'),
    cancelledAt: tstz('cancelled_at'),
    failedAt: tstz('failed_at'),
    returnedAt: tstz('returned_at'),

    idempotencyKey: text('idempotency_key').notNull(),
    version: integer('version').notNull().default(0),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('deliveries_public_code_key').on(t.publicCode),
    // A double-tapped "Confirm" (or a retried request) can never create two bookings.
    uniqueIndex('deliveries_customer_idempotency_key').on(t.customerId, t.idempotencyKey),
    // One active delivery per rider, enforced by the database so concurrent assignments
    // cannot both succeed.
    uniqueIndex('deliveries_one_active_per_rider')
      .on(t.riderId)
      .where(sql`${t.status} in (${activeStatusList})`),
    index('deliveries_customer_created_idx').on(t.customerId, t.createdAt),
    index('deliveries_status_created_idx').on(t.status, t.createdAt),
    check('deliveries_fare_positive', sql`${t.fareAmount} > 0`),
    check(
      'deliveries_split_adds_up',
      sql`${t.commissionAmount} + ${t.riderEarning} = ${t.fareAmount} and ${t.commissionAmount} >= 0`,
    ),
    check('deliveries_cancellation_fee_non_negative', sql`${t.cancellationFee} >= 0`),
    check(
      'deliveries_rider_when_active',
      sql`${t.status} not in (${activeStatusList}, 'delivered', 'failed', 'returned') or ${t.riderId} is not null`,
    ),
  ],
);

/** Append-only audit trail of every status change. */
export const deliveryEvents = pgTable(
  'delivery_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    fromStatus: deliveryStatus('from_status'),
    toStatus: deliveryStatus('to_status').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorRole: actorRole('actor_role').notNull(),
    note: text('note'),
    lat: coord('lat'),
    lng: coord('lng'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('delivery_events_delivery_idx').on(t.deliveryId, t.createdAt)],
);
