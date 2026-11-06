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
import { KycService } from './modules/kyc/service.ts';
import { kycRoutes } from './modules/kyc/routes.ts';
import { PayerNotifier } from './modules/deliveries/payerNotice.ts';
import { riderFeatureRoutes } from './modules/riders/featureRoutes.ts';
import { ratingRoutes } from './modules/ratings/routes.ts';
import { adminRiderFeatureRoutes } from './modules/admin/riderFeatures.ts';
import { adminNotificationRoutes } from './modules/admin/notifications.ts';
import { purgeOldRoutes } from './modules/history/service.ts';
import { getSettings } from './modules/platform/settings.ts';

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
  const smsProvider = sms ?? createSmsProvider(config);
  const otp = new OtpService({
    db,
    config,
    clock,
    sms: smsProvider,
    sessions,
    log: app.log,
  });
  const auth = createAuthenticator(sessions, config);
  const hub = new RealtimeHub(db, app.log);
  app.addHook('onClose', async () => hub.close());
  const dispatcher = new Dispatcher(db, clock, app.log, dispatch, hub);
  const payments = new PaymentService(db, clock);
  const deliveries = new DeliveryService(db, clock, (id) => dispatcher.dispatch(id), hub, payments);
  const notifier = new PayerNotifier({
    db,
    sms: smsProvider,
    realtime: hub,
    appOrigin: config.APP_ORIGIN,
    log: app.log,
  });
  const riders = new RiderService(db, clock, hub, payments, notifier);
  const kyc = new KycService(db, config, clock, hub);
  const geoProvider = geo ?? createGeoProvider(config);

  // Delete identity photos and route points past their retention period, hourly (not in tests: they call it).
  if (config.NODE_ENV !== 'test') {
    // Recorded GPS routes are kept for the configured number of days, then deleted.
    const purge = () =>
      Promise.all([
        kyc
          .purgeExpired()
          .then((n) => n > 0 && app.log.info({ removed: n }, 'expired KYC photos deleted'))
          .catch((err) => app.log.error({ err }, 'KYC purge failed')),
        getSettings(db)
          .then((s) => purgeOldRoutes(db, s.routeRetentionDays, clock.now()))
          .then((n) => n > 0 && app.log.info({ removed: n }, 'old route points deleted'))
          .catch((err) => app.log.error({ err }, 'route purge failed')),
      ]);
    const timer = setInterval(purge, 3_600_000);
    timer.unref();
    app.addHook('onReady', async () => void purge());
    app.addHook('onClose', async () => clearInterval(timer));
  }

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
      // Before riderRoutes: its catch-all for unknown /rider/* paths must not shadow these.
      await api.register(kycRoutes, { db, clock, auth, kyc });
      await api.register(riderFeatureRoutes, { db, clock, auth, riders });
      await api.register(ratingRoutes, { db, clock, auth });
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
      await api.register(adminRiderFeatureRoutes, { db, clock, auth });
      await api.register(adminNotificationRoutes, { db, auth });
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

  return { app, dispatcher, hub, deliveries, riders, kyc };
}
