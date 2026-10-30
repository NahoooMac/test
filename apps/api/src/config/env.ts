import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

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
    DATABASE_URL: z.preprocess(emptyToUndefined, z.string().optional()),
    DATABASE_URL_DIRECT: z.preprocess(emptyToUndefined, z.string().optional()),
    PGLITE_DIR: z.string().default('.data/pglite'),
    ALLOW_REMOTE_MIGRATIONS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    SMS_PROVIDER: z.enum(['console', 'afromessage']).default('console'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (!env.DATABASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'required in production' });
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
