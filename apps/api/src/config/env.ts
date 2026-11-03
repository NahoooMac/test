import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

// Development-only default; production refuses to start with it.
const DEV_OTP_SECRET = 'dev-only-otp-secret-not-for-production-use';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    // Not `PORT`: dev tooling and hosts often set PORT for the web server, which must not move the API.
    API_PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    APP_ORIGIN: z.url().default('http://localhost:5173'),
    // Which X-Forwarded-For hops to believe for the client IP (per-IP OTP limits depend on it):
    // a hop count ("1" = one reverse proxy in front), "false", or comma-separated proxy IPs/CIDRs.
    // Unset: 1 in production, none elsewhere. Never "true" — anyone could then fake their IP.
    TRUST_PROXY: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .refine((v) => v !== 'true', 'use a hop count or proxy addresses, not "true"')
        .optional(),
    ),
    DATABASE_URL: z.preprocess(emptyToUndefined, z.string().optional()),
    DATABASE_URL_DIRECT: z.preprocess(emptyToUndefined, z.string().optional()),
    PGLITE_DIR: z.string().default('.data/pglite'),
    /** Built web app to serve from the API (single origin in production). Empty = API only. */
    WEB_DIST_DIR: z.preprocess(emptyToUndefined, z.string().optional()),
    ALLOW_REMOTE_MIGRATIONS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    SMS_PROVIDER: z.enum(['console', 'afromessage']).default('console'),
    AFROMESSAGE_BASE_URL: z.url().default('https://api.afromessage.com'),
    AFROMESSAGE_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
    AFROMESSAGE_IDENTIFIER_ID: z.preprocess(emptyToUndefined, z.string().optional()),
    AFROMESSAGE_SENDER: z.preprocess(emptyToUndefined, z.string().optional()),
    SMS_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    // Hard cap on OTP SMS sends per UTC day across all users (cost kill switch).
    SMS_DAILY_BUDGET: z.coerce.number().int().nonnegative().default(500),

    // Keyed hash for OTP codes. Must be a long random secret in production.
    OTP_HMAC_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).default(DEV_OTP_SECRET)),
    OTP_TTL_SEC: z.coerce.number().int().positive().default(300),
    OTP_RESEND_COOLDOWN_SEC: z.coerce.number().int().positive().default(60),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    OTP_LOCKOUT_MIN: z.coerce.number().int().positive().default(15),
    OTP_PHONE_SENDS_PER_15MIN: z.coerce.number().int().positive().default(3),
    OTP_PHONE_SENDS_PER_DAY: z.coerce.number().int().positive().default(6),
    OTP_IP_SENDS_PER_HOUR: z.coerce.number().int().positive().default(10),
    OTP_IP_VERIFIES_PER_15MIN: z.coerce.number().int().positive().default(30),

    // Server-side only. Without a key, a small offline place list is used (dev/tests).
    YANDEX_GEOCODER_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
    YANDEX_GEOSUGGEST_KEY: z.preprocess(emptyToUndefined, z.string().optional()),

    SESSION_IDLE_DAYS: z.coerce.number().int().positive().default(30),
    SESSION_ABSOLUTE_DAYS: z.coerce.number().int().positive().default(90),
    ADMIN_SESSION_HOURS: z.coerce.number().int().positive().default(12),

    // Rider KYC photos: AES-256 key (base64 of 32 random bytes), kept out of the database.
    // Required in production; development derives one from OTP_HMAC_SECRET.
    KYC_ENCRYPTION_KEY: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be base64 of 32 bytes')
        .optional(),
    ),
    // Photos are deleted this many days after the admin's decision (they are not needed after).
    KYC_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),

    DEMO_MODE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .superRefine((env, ctx) => {
    if (env.SMS_PROVIDER === 'afromessage' && !env.AFROMESSAGE_TOKEN) {
      ctx.addIssue({
        code: 'custom',
        path: ['AFROMESSAGE_TOKEN'],
        message: 'required when SMS_PROVIDER=afromessage',
      });
    }
    if (env.SESSION_IDLE_DAYS > env.SESSION_ABSOLUTE_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_IDLE_DAYS'],
        message: 'must not exceed SESSION_ABSOLUTE_DAYS',
      });
    }
    if (env.NODE_ENV !== 'production') return;
    if (env.OTP_HMAC_SECRET === DEV_OTP_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_HMAC_SECRET'],
        message: 'set a random secret of at least 32 characters in production',
      });
    }
    if (!env.DATABASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'required in production' });
    }
    if (!env.KYC_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['KYC_ENCRYPTION_KEY'],
        message: 'required in production (openssl rand -base64 32)',
      });
    }
    if (env.DEMO_MODE) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEMO_MODE'],
        message: 'demo accounts (fixed OTP codes) are not allowed in production',
      });
    }
    if (env.SMS_PROVIDER === 'console') {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: 'console provider is not allowed in production',
      });
    }
    if (!env.APP_ORIGIN.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'must be https in production',
      });
    }
  });

export type Config = z.infer<typeof envSchema>;

/** Fastify `trustProxy` value for the configured environment. */
export function trustProxySetting(config: Config): number | string | false {
  const raw = config.TRUST_PROXY ?? (config.NODE_ENV === 'production' ? '1' : 'false');
  if (raw === 'false') return false;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Print variable names and problems only — never values.
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}

/** Loads apps/api/.env if present (Node's built-in loader; no dotenv dependency). */
export function loadDotEnv(path = '.env'): void {
  try {
    process.loadEnvFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
