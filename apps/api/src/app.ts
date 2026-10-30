import Fastify, { type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import type { Config } from './config/env.ts';
import type { Database } from './db/client.ts';
import { registerErrorHandling } from './shared/errors.ts';
import { healthRoutes } from './modules/health/routes.ts';
import { authRoutes } from './modules/auth/routes.ts';

export interface AppDeps {
  config: Config;
  database: Database;
}

export async function buildApp({ config, database }: AppDeps) {
  const logger: FastifyServerOptions['logger'] =
    config.NODE_ENV === 'development'
      ? { level: config.LOG_LEVEL, transport: { target: 'pino-pretty', options: { singleLine: true } } }
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

  await app.register(
    async (api) => {
      await api.register(healthRoutes, { database });
      await api.register(authRoutes);
    },
    { prefix: '/api' },
  );

  return app;
}
