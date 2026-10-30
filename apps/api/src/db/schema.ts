// Phase 2 schema: identity, sessions, OTP, SMS log, rate limiting, service areas.
// Delivery, rider, pricing and payment tables arrive in Phase 4 migrations.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
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
import { LANGUAGES, USER_ROLES, USER_STATUSES } from '@dp/shared';

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
