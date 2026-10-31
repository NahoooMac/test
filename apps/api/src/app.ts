import Fastify, { type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { trustProxySetting, type Config } from './config/env.ts';
import type { Database } from './db/client.ts';
import { createSmsProvider, type SmsProvider } from './integrations/sms/index.ts';
import { createGeoProvider, type GeoProvider } from './integrations/maps/index.ts';
import { systemClock, type Clock } from './shared/clock.ts';
import { registerErrorHandling } from './shared/errors.ts';
import { healthRoutes } from './modules/health/routes.ts';
import { authRoutes } from './modules/auth/routes.ts';
import { createAuthenticator, registerCsrfGuard } from './modules/auth/http.ts';
import { OtpService } from './modules/auth/otp-service.ts';
import { SessionService } from './modules/auth/sessions.ts';
import { DeliveryService } from './modules/deliveries/service.ts';
import { deliveryRoutes } from './modules/deliveries/routes.ts';
import { geoRoutes } from './modules/geo/routes.ts';
import { Dispatcher, type DispatchOptions } from './modules/dispatch/dispatcher.ts';
import { RiderService } from './modules/riders/service.ts';
import { riderRoutes } from './modules/riders/routes.ts';
import { adminRiderRoutes } from './modules/admin/riders.ts';
import { adminOpsRoutes } from './modules/admin/ops.ts';
import { RealtimeHub } from './modules/realtime/hub.ts';
import { realtimeRoutes } from './modules/realtime/routes.ts';
import { PaymentService } from './modules/payments/service.ts';
import { adminDeliveryRoutes } from './modules/admin/deliveries.ts';
import { adminFinanceRoutes } from './modules/admin/finance.ts';
import { adminUserRoutes } from './modules/admin/users.ts';

export interface AppDeps {
  config: Config;
  database: Database;
  /** Overridable for tests. */
  clock?: Clock;
  sms?: SmsProvider;
  geo?: GeoProvider;
  dispatch?: Partial<DispatchOptions>;
}

export async function buildApp({
  config,
  database,
  clock = systemClock,
  sms,
  geo,
  dispatch,
}: AppDeps) {
  const logger: FastifyServerOptions['logger'] =
    config.NODE_ENV === 'development'
      ? {
          level: config.LOG_LEVEL,
          transport: { target: 'pino-pretty', options: { singleLine: true } },
        }
      : { level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL };

  const app = Fastify({
    logger,
    trustProxy: trustProxySetting(config) as FastifyServerOptions['trustProxy'],
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
  const hub = new RealtimeHub(db, app.log);
  app.addHook('onClose', async () => hub.close());
  const dispatcher = new Dispatcher(db, clock, app.log, dispatch, hub);
  const payments = new PaymentService(db, clock);
  const deliveries = new DeliveryService(db, clock, (id) => dispatcher.dispatch(id), hub, payments);
  const riders = new RiderService(db, clock, hub, payments);
  const geoProvider = geo ?? createGeoProvider(config);

  await app.register(
    async (api) => {
      registerCsrfGuard(api, config);
      await api.register(healthRoutes, { database });
      await api.register(authRoutes, {
        db,
        config,
        clock,
        otp,
        sessions,
        auth,
        onSessionRevoked: (id) => hub.closeSession(id),
      });
      await api.register(deliveryRoutes, { db, clock, auth, deliveries });
      await api.register(geoRoutes, { db, clock, auth, geo: geoProvider });
      await api.register(riderRoutes, { db, clock, auth, riders, dispatcher });
      await api.register(adminRiderRoutes, { db, clock, auth, realtime: hub });
      await api.register(adminOpsRoutes, { db, clock, auth });
      await api.register(adminDeliveryRoutes, {
        db,
        clock,
        auth,
        deliveries,
        dispatcher,
        realtime: hub,
      });
      await api.register(adminFinanceRoutes, { db, clock, auth, payments, realtime: hub });
      await api.register(adminUserRoutes, {
        db,
        clock,
        auth,
        sessions,
        closeUserStreams: (id) => hub.closeUser(id),
      });
      await api.register(realtimeRoutes, { db, clock, auth, hub });
    },
    { prefix: '/api' },
  );

  return { app, dispatcher, hub };
}
