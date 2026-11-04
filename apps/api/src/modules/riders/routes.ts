import type { FastifyInstance } from 'fastify';
import {
  contactAttemptSchema,
  completeDeliverySchema,
  recordPaymentSchema,
  riderApplySchema,
  riderLocationSchema,
  riderStatusSchema,
  riderTransitionSchema,
  type RiderHome,
  type RiderJob,
  type RiderProfile,
} from '@dp/shared';
import type { Db } from '../../db/client.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, parseInput, tooManyRequests } from '../../shared/errors.ts';
import { consume } from '../../shared/rate-limit.ts';
import type { Authenticator } from '../auth/http.ts';
import type { Dispatcher } from '../dispatch/dispatcher.ts';
import type { RiderService } from './service.ts';

type IdParams = { Params: { id: string } };

export async function riderRoutes(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Authenticator; riders: RiderService; dispatcher: Dispatcher },
) {
  const { db, clock, auth, riders, dispatcher } = deps;

  // Any signed-in non-staff user may apply; afterwards the account is a rider account.
  app.post('/rider/apply', async (req, reply): Promise<RiderProfile> => {
    const { user } = await auth.require(req, reply);
    const input = parseInput(riderApplySchema, req.body);
    const profile = await riders.apply(user.id, input);
    reply.status(201);
    return profile;
  });

  // Polled by the rider app (every few seconds) until live updates arrive in Phase 4c.
  app.get('/rider/home', async (req, reply): Promise<RiderHome> => {
    const { user } = await auth.require(req, reply, 'rider');
    reply.header('Cache-Control', 'no-store');
    return riders.home(user.id);
  });

  app.post('/rider/status', async (req, reply): Promise<RiderProfile> => {
    const { user } = await auth.require(req, reply, 'rider');
    const { online } = parseInput(riderStatusSchema, req.body);
    return riders.setOnline(user.id, online);
  });

  app.post('/rider/location', async (req, reply) => {
    const { user } = await auth.require(req, reply, 'rider');
    const { lat, lng } = parseInput(riderLocationSchema, req.body);
    // GPS pings are cheap but should not flood the database.
    const r = await consume(
      db,
      { key: `rider:loc:${user.id}`, windowSec: 60, limit: 30 },
      clock.now(),
    );
    if (!r.allowed) throw tooManyRequests(r.retryAfterSec);
    await riders.updateLocation(user.id, lat, lng);
    return reply.status(204).send();
  });

  app.post<IdParams>('/rider/offers/:id/accept', async (req, reply): Promise<RiderJob> => {
    const { user } = await auth.require(req, reply, 'rider');
    return riders.accept(user.id, req.params.id);
  });

  app.post<IdParams>('/rider/offers/:id/decline', async (req, reply) => {
    const { user } = await auth.require(req, reply, 'rider');
    await riders.decline(user.id, req.params.id);
    // Offer it to the next rider straight away rather than waiting for the next tick.
    void dispatcher.tick().catch((err) => req.log.error({ err }, 'dispatch after decline failed'));
    return reply.status(204).send();
  });

  app.post<IdParams>('/rider/jobs/:id/step', async (req, reply): Promise<RiderJob> => {
    const { user } = await auth.require(req, reply, 'rider');
    const { to, lat, lng } = parseInput(riderTransitionSchema, req.body);
    return riders.advance(user.id, req.params.id, to, { lat, lng });
  });

  app.post<IdParams>('/rider/jobs/:id/release', async (req, reply): Promise<RiderJob> => {
    const { user } = await auth.require(req, reply, 'rider');
    const job = await riders.release(user.id, req.params.id);
    void dispatcher.tick().catch((err) => req.log.error({ err }, 'dispatch after release failed'));
    return job;
  });

  app.post<IdParams>('/rider/jobs/:id/contact-attempts', async (req, reply): Promise<RiderJob> => {
    const { user } = await auth.require(req, reply, 'rider');
    const { outcome } = parseInput(contactAttemptSchema, req.body);
    return riders.logContactAttempt(user.id, req.params.id, outcome);
  });

  app.post<IdParams>('/rider/jobs/:id/fail', async (req, reply): Promise<RiderJob> => {
    const { user } = await auth.require(req, reply, 'rider');
    return riders.fail(user.id, req.params.id);
  });

  app.post<IdParams>('/rider/jobs/:id/payment', async (req, reply): Promise<RiderJob> => {
    const { user } = await auth.require(req, reply, 'rider');
    const { method, reference, outcome, note } = parseInput(recordPaymentSchema, req.body);
    return riders.recordFarePayment(user.id, req.params.id, method, reference, outcome, note);
  });

  // "Done": payment recorded and parcel handed over. Idempotent (double taps, network retries).
  app.post<IdParams>('/rider/jobs/:id/complete', async (req, reply): Promise<RiderJob> => {
    const { user } = await auth.require(req, reply, 'rider');
    parseInput(completeDeliverySchema, req.body);
    return riders.complete(user.id, req.params.id);
  });

  app.post<IdParams>('/rider/jobs/:id/final-price/resend', async (req, reply) => {
    const { user } = await auth.require(req, reply, 'rider');
    const limit = await consume(
      db,
      { key: `rider:priceSms:${req.params.id}`, windowSec: 600, limit: 3 },
      clock.now(),
    );
    if (!limit.allowed) throw tooManyRequests(limit.retryAfterSec);
    return riders.resendFinalPrice(user.id, req.params.id);
  });

  app.get('/rider/ledger', async (req, reply) => {
    const { user } = await auth.require(req, reply, 'rider');
    return riders.ledger(user.id);
  });

  app.get('/rider/jobs', async (req, reply) => {
    const { user } = await auth.require(req, reply, 'rider');
    const rows = await riders.recentJobs(user.id);
    return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
  });

  // Unknown rider routes should not fall through to a confusing 404 body.
  app.all('/rider/*', async () => {
    throw new AppError(404, 'NOT_FOUND', 'Not found.');
  });
}
