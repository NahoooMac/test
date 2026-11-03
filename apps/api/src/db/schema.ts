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
  CONTACT_OUTCOMES,
  DELIVERY_STATUSES,
  KYC_DOCUMENT_KINDS,
  KYC_STATUSES,
  LANGUAGES,
  PARCEL_SIZES,
  PAYERS,
  PAYMENT_METHODS,
  RIDER_APPROVAL_STATUSES,
  USER_ROLES,
  USER_STATUSES,
  VEHICLE_TYPES,
  type KycDocumentKind,
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

/** Username/password sign-in, for admins only. Set with `npm run admin:password`. */
export const adminCredentials = pgTable(
  'admin_credentials',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    username: text('username').notNull(),
    // scrypt$N$r$p$salt$hash; the password itself is never stored.
    passwordHash: text('password_hash').notNull(),
    passwordChangedAt: tstz('password_changed_at').notNull().defaultNow(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    // Verified by SMS code; receives codes for 2-step sign-in and password reset.
    recoveryPhone: text('recovery_phone'),
    twoStep: boolean('two_step').notNull().default(false),
  },
  (t) => [
    uniqueIndex('admin_credentials_username_key').on(t.username),
    check('admin_credentials_username_format', sql`${t.username} ~ '^[a-z0-9._-]{3,32}$'`),
    check(
      'admin_credentials_recovery_phone_format',
      sql`${t.recoveryPhone} is null or ${t.recoveryPhone} ~ '^\\+251[79][0-9]{8}$'`,
    ),
    check(
      'admin_credentials_two_step_needs_phone',
      sql`not ${t.twoStep} or ${t.recoveryPhone} is not null`,
    ),
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
export const kycStatus = pgEnum('kyc_status', KYC_STATUSES);
export const kycDocumentKind = pgEnum('kyc_document_kind', KYC_DOCUMENT_KINDS);
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
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: tstz('reviewed_at'),
    rejectionReason: text('rejection_reason'),
    // Identity verification (admin-reviewed live camera captures; see kyc_documents).
    kycStatus: kycStatus('kyc_status').notNull().default('not_submitted'),
    kycSubmittedAt: tstz('kyc_submitted_at'),
    kycReviewedAt: tstz('kyc_reviewed_at'),
    kycReviewedBy: uuid('kyc_reviewed_by').references(() => users.id),
    kycReason: text('kyc_reason'),
    /** Captures the admin asked the rider to redo. */
    kycRetake: jsonb('kyc_retake').$type<KycDocumentKind[]>().notNull().default([]),
    // Optional home location: a matching preference only, never shown to customers or riders.
    homeLat: coord('home_lat'),
    homeLng: coord('home_lng'),
    homeRadiusKm: numeric('home_radius_km', { precision: 5, scale: 2, mode: 'number' }),
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
    // The gate for every job path (dispatch, online, accept, admin assign) is approval_status =
    // 'approved'; this makes approval impossible without an approved identity check.
    check(
      'riders_approved_needs_kyc',
      sql`${t.approvalStatus} <> 'approved' or ${t.kycStatus} = 'approved'`,
    ),
    check(
      'riders_home_complete',
      sql`(${t.homeLat} is null) = (${t.homeLng} is null) and (${t.homeRadiusKm} is null or (${t.homeLat} is not null and ${t.homeRadiusKm} > 0 and ${t.homeRadiusKm} <= 30))`,
    ),
  ],
);

/** Sub-cities a rider wants offers in. FK to the seeded list, so only supported areas exist. */
export const riderServiceAreas = pgTable(
  'rider_service_areas',
  {
    riderId: uuid('rider_id')
      .notNull()
      .references(() => riders.userId, { onDelete: 'cascade' }),
    subCity: text('sub_city')
      .notNull()
      .references(() => serviceAreas.slug),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.riderId, t.subCity] })],
);

/** Admin-configurable values (wallet limits, matching weights, retention). Changes are audited. */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const pointsType = pgEnum('points_type', [
  'initial',
  'completion',
  'rider_cancellation',
  'adjustment',
]);

/** Rider points ledger: balance = SUM(delta). Append-only; awards/deductions are once-only. */
export const riderPoints = pgTable(
  'rider_points',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => riders.userId, { onDelete: 'cascade' }),
    deliveryId: uuid('delivery_id').references(() => deliveries.id, { onDelete: 'restrict' }),
    type: pointsType('type').notNull(),
    delta: integer('delta').notNull(),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('rider_points_one_initial').on(t.riderId).where(sql`${t.type} = 'initial'`),
    uniqueIndex('rider_points_once_per_delivery')
      .on(t.deliveryId, t.riderId, t.type)
      .where(sql`${t.type} in ('completion', 'rider_cancellation')`),
    check(
      'rider_points_rules',
      sql`(${t.type} = 'initial' and ${t.delta} = 50) or (${t.type} = 'completion' and ${t.delta} = 1 and ${t.deliveryId} is not null) or (${t.type} = 'rider_cancellation' and ${t.delta} = -3 and ${t.deliveryId} is not null) or (${t.type} = 'adjustment' and ${t.delta} <> 0 and ${t.createdBy} is not null)`,
    ),
    index('rider_points_rider_idx').on(t.riderId, t.createdAt),
  ],
);

export const ratingStatus = pgEnum('rating_status', ['active', 'reported', 'removed']);

/** One customer rating per delivered delivery. Reported ratings await admin review. */
export const deliveryRatings = pgTable(
  'delivery_ratings',
  {
    deliveryId: uuid('delivery_id')
      .primaryKey()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => riders.userId),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id),
    stars: smallint('stars').notNull(),
    comment: text('comment'),
    status: ratingStatus('status').notNull().default('active'),
    reportReason: text('report_reason'),
    reportedAt: tstz('reported_at'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: tstz('reviewed_at'),
    reviewNote: text('review_note'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('delivery_ratings_stars', sql`${t.stars} between 1 and 5`),
    index('delivery_ratings_rider_idx').on(t.riderId, t.createdAt),
    index('delivery_ratings_status_idx').on(t.status, t.createdAt),
  ],
);

export const topupStatus = pgEnum('topup_status', ['pending', 'verified', 'rejected']);

/**
 * A rider's claim that they sent money to top up their wallet. Nothing is credited until an admin
 * verifies the transfer; the same transaction reference can't be credited twice.
 */
export const walletTopups = pgTable(
  'wallet_topups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => riders.userId, { onDelete: 'restrict' }),
    amount: money('amount').notNull(),
    method: paymentMethod('method').notNull(),
    reference: text('reference').notNull(),
    status: topupStatus('status').notNull().default('pending'),
    note: text('note'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: tstz('reviewed_at'),
    reviewNote: text('review_note'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('wallet_topups_amount', sql`${t.amount} > 0 and ${t.amount} <= 100000`),
    check('wallet_topups_method', sql`${t.method} in ('telebirr', 'cbe_birr')`),
    uniqueIndex('wallet_topups_unique_reference')
      .on(t.method, sql`upper(${t.reference})`)
      .where(sql`${t.status} <> 'rejected'`),
    index('wallet_topups_status_idx').on(t.status, t.createdAt),
    index('wallet_topups_rider_idx').on(t.riderId, t.createdAt),
  ],
);

/**
 * One current photo per rider and kind. Encrypted at rest (AES-256-GCM, key outside the database,
 * bound to rider + kind), served only to admins, deleted on rejection, retake, and after retention.
 */
export const kycDocuments = pgTable(
  'kyc_documents',
  {
    riderId: uuid('rider_id')
      .notNull()
      .references(() => riders.userId, { onDelete: 'cascade' }),
    kind: kycDocumentKind('kind').notNull(),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256').notNull(),
    capturedAt: tstz('captured_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.riderId, t.kind] })],
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
    /** Incremented when an admin re-offers the job; offers are unique per rider per round. */
    dispatchRound: integer('dispatch_round').notNull().default(0),
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

// ── Phase 4b: dispatch offers and failed-delivery contact log ───────────────

export const offerStatus = pgEnum('offer_status', [
  'offered',
  'accepted',
  'declined',
  'expired',
  'withdrawn',
]);
export const contactOutcome = pgEnum('contact_outcome', CONTACT_OUTCOMES);

/** One row per job offered to a rider. Riders see at most one open offer at a time. */
export const deliveryOffers = pgTable(
  'delivery_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => riders.userId, { onDelete: 'cascade' }),
    status: offerStatus('status').notNull().default('offered'),
    toPickupKm: numeric('to_pickup_km', { precision: 6, scale: 2, mode: 'number' }).notNull(),
    round: integer('round').notNull().default(0),
    offeredAt: tstz('offered_at').notNull().defaultNow(),
    expiresAt: tstz('expires_at').notNull(),
    respondedAt: tstz('responded_at'),
    /** Why this rider was chosen: the matching score and its parts (explainability). */
    score: jsonb('score').$type<Record<string, number>>(),
  },
  (t) => [
    // A delivery is offered to one rider at a time …
    uniqueIndex('delivery_offers_one_open_per_delivery')
      .on(t.deliveryId)
      .where(sql`${t.status} = 'offered'`),
    // … and a rider holds at most one open offer, even when several deliveries dispatch at once.
    uniqueIndex('delivery_offers_one_open_per_rider')
      .on(t.riderId)
      .where(sql`${t.status} = 'offered'`),
    // Within a dispatch round, a rider who declined or let an offer lapse is not asked again.
    uniqueIndex('delivery_offers_once_per_rider_round').on(t.deliveryId, t.riderId, t.round),
    index('delivery_offers_open_expiry_idx').on(t.status, t.expiresAt),
  ],
);

export const routeStage = pgEnum('route_stage', ['to_pickup', 'to_dropoff', 'returning']);

/**
 * The rider's actual GPS positions during a job (not the planned route). Stage is derived on the
 * server from the delivery's own timestamps. Kept as history after the job ends, until retention.
 */
export const deliveryRoutePoints = pgTable(
  'delivery_route_points',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => riders.userId),
    lat: coord('lat').notNull(),
    lng: coord('lng').notNull(),
    recordedAt: tstz('recorded_at').notNull(),
    stage: routeStage('stage').notNull(),
    accuracyM: integer('accuracy_m'),
    source: text('source').notNull().default('gps'),
    receivedAt: tstz('received_at').notNull().defaultNow(),
  },
  (t) => [
    // A re-sent batch (after a lost connection) never stores a fix twice.
    uniqueIndex('delivery_route_points_once').on(t.deliveryId, t.recordedAt),
    index('delivery_route_points_received_idx').on(t.receivedAt),
    check('delivery_route_points_coords', sql`${t.lat} between -90 and 90 and ${t.lng} between -180 and 180`),
  ],
);

/** Calls the rider made to an unreachable receiver; backs the failed-delivery rule. */
export const contactAttempts = pgTable(
  'contact_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => riders.userId),
    outcome: contactOutcome('outcome').notNull(),
    attemptedAt: tstz('attempted_at').notNull().defaultNow(),
  },
  (t) => [index('contact_attempts_delivery_idx').on(t.deliveryId, t.attemptedAt)],
);

// ── Phase 4d: payments, rider ledger, admin audit ───────────────────────────

export const paymentKind = pgEnum('payment_kind', ['fare', 'cancellation_fee']);
export const paymentStatus = pgEnum('payment_status', ['due', 'collected', 'waived']);
export const ledgerType = pgEnum('ledger_type', ['commission', 'settlement', 'adjustment']);

/**
 * Money the sender or receiver paid the rider directly (cash, Telebirr, CBE Birr). One row per
 * delivery and kind: recording the same payment twice returns the original row.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'restrict' }),
    kind: paymentKind('kind').notNull(),
    status: paymentStatus('status').notNull(),
    amount: money('amount').notNull(),
    method: paymentMethod('method'),
    payer: payer('payer').notNull(),
    reference: text('reference'),
    collectedBy: uuid('collected_by').references(() => riders.userId),
    recordedBy: uuid('recorded_by').references(() => users.id),
    collectedAt: tstz('collected_at'),
    note: text('note'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payments_one_per_delivery_kind').on(t.deliveryId, t.kind),
    check('payments_amount_positive', sql`${t.amount} > 0`),
    check(
      'payments_collected_has_method',
      sql`${t.status} <> 'collected' or (${t.method} is not null and ${t.collectedAt} is not null)`,
    ),
    index('payments_status_idx').on(t.status, t.createdAt),
  ],
);

/**
 * What each rider owes the platform. Positive = rider owes (commission on fares they collected);
 * negative = paid to the platform (settlements). Balance = SUM(amount). Append-only.
 */
export const riderLedger = pgTable(
  'rider_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => riders.userId, { onDelete: 'restrict' }),
    type: ledgerType('type').notNull(),
    amount: money('amount').notNull(),
    deliveryId: uuid('delivery_id').references(() => deliveries.id, { onDelete: 'restrict' }),
    method: paymentMethod('method'),
    reference: text('reference'),
    note: text('note'),
    idempotencyKey: text('idempotency_key'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Commission is charged exactly once per delivery.
    uniqueIndex('rider_ledger_one_commission_per_delivery')
      .on(t.deliveryId)
      .where(sql`${t.type} = 'commission'`),
    uniqueIndex('rider_ledger_idempotency_key').on(t.idempotencyKey),
    check(
      'rider_ledger_sign',
      sql`(${t.type} = 'commission' and ${t.amount} >= 0) or (${t.type} = 'settlement' and ${t.amount} < 0) or ${t.type} = 'adjustment'`,
    ),
    index('rider_ledger_rider_idx').on(t.riderId, t.createdAt),
  ],
);

/** Every admin action, for accountability. Append-only. */
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('admin_audit_log_target_idx').on(t.targetType, t.targetId, t.createdAt),
    index('admin_audit_log_created_idx').on(t.createdAt),
  ],
);
