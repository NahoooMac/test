import Fastify, { type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import type { Config } from './config/env.ts';
import type { Database } from './db/client.ts';
import { createSmsProvider, type SmsProvider } from './integrations/sms/index.ts';
import { systemClock, type Clock } from './shared/clock.ts';
import { registerErrorHandling } from './shared/errors.ts';
import { healthRoutes } from './modules/health/routes.ts';
import { authRoutes } from './modules/auth/routes.ts';
import { createAuthenticator, registerCsrfGuard } from './modules/auth/http.ts';
import { OtpService } from './modules/auth/otp-service.ts';
import { SessionService } from './modules/auth/sessions.ts';

export interface AppDeps {
  config: Config;
  database: Database;
  /** Overridable for tests. */
  clock?: Clock;
  sms?: SmsProvider;
}

export async function buildApp({ config, database, clock = systemClock, sms }: AppDeps) {
  const logger: FastifyServerOptions['logger'] =
    config.NODE_ENV === 'development'
      ? {
          level: config.LOG_LEVEL,
          transport: { target: 'pino-pretty', options: { singleLine: true } },
        }
      : { level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL };

  const app = Fastify({
    logger,
    trustProxy: config.NODE_ENV === 'production',
    bodyLimit: 256 * 1024,
    genReqId: () => crypto.randomUUID(),
  });

  registerErrorHandling(app);

  // The API serves JSON only; a strict CSP costs nothing here.
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });
  await app.register(cookie);

  const db = database.db;
  const sessions = new SessionService(db, config, clock);
  const otp = new OtpService({
    db,
    config,
    clock,
    sms: sms ?? createSmsProvider(config),
    sessions,
    log: app.log,
  });
  const auth = createAuthenticator(sessions, config);

  await app.register(
    async (api) => {
      registerCsrfGuard(api, config);
      await api.register(healthRoutes, { database });
      await api.register(authRoutes, { db, config, clock, otp, sessions, auth });
    },
    { prefix: '/api' },
  );

  return app;
}
