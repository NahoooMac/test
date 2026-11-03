import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ratingReviewSchema, ratingSchema, reportRatingSchema, type MyRating } from '@dp/shared';
import type { Db } from '../../db/client.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, parseInput, tooManyRequests } from '../../shared/errors.ts';
import { consume } from '../../shared/rate-limit.ts';
import type { Authenticator } from '../auth/http.ts';
import { adminRatings, myRating, rateDelivery, reportRating, reviewRating, riderRatings } from './service.ts';

type IdParams = { Params: { id: string } };

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
const notFound = () => new AppError(404, 'NOT_FOUND', 'Not found.');
const listQuery = z.object({ status: z.enum(['active', 'reported', 'removed']).optional() });

export async function ratingRoutes(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Authenticator },
) {
  const { db, clock, auth } = deps;

  // ── Customer ───────────────────────────────────────────────────────────────

  app.get<IdParams>('/deliveries/:id/rating', async (req, reply): Promise<MyRating | null> => {
    const { user } = await auth.require(req, reply, 'customer');
    if (!isUuid(req.params.id)) throw notFound();
    reply.header('Cache-Control', 'no-store');
    return myRating(db, user.id, req.params.id);
  });

  app.post<IdParams>('/deliveries/:id/rating', async (req, reply): Promise<MyRating> => {
    const { user } = await auth.require(req, reply, 'customer');
    const limit = await consume(
      db,
      { key: `rating:${user.id}`, windowSec: 3600, limit: 30 },
      clock.now(),
    );
    if (!limit.allowed) throw tooManyRequests(limit.retryAfterSec);
    const input = parseInput(ratingSchema, req.body);
    reply.status(201);
    return rateDelivery(db, user.id, req.params.id, input, clock.now());
  });

  // ── Rider ──────────────────────────────────────────────────────────────────

  app.get('/rider/ratings', async (req, reply) => {
    const { user } = await auth.require(req, reply, 'rider');
    reply.header('Cache-Control', 'no-store');
    return riderRatings(db, user.id);
  });

  app.post<IdParams>('/rider/ratings/:id/report', async (req, reply) => {
    const { user } = await auth.require(req, reply, 'rider');
    if (!isUuid(req.params.id)) throw notFound();
    const { reason } = parseInput(reportRatingSchema, req.body);
    await reportRating(db, user.id, req.params.id, reason, clock.now());
    return reply.status(204).send();
  });

  // ── Admin ──────────────────────────────────────────────────────────────────

  app.get('/admin/ratings', async (req, reply) => {
    await auth.require(req, reply, 'admin');
    const { status } = parseInput(listQuery, req.query);
    reply.header('Cache-Control', 'no-store');
    return adminRatings(db, status);
  });

  app.post<IdParams>('/admin/ratings/:id/review', async (req, reply) => {
    const { user } = await auth.require(req, reply, 'admin');
    if (!isUuid(req.params.id)) throw notFound();
    const { decision, note } = parseInput(ratingReviewSchema, req.body);
    await reviewRating(db, user.id, req.params.id, decision, note, clock.now());
    return reply.status(204).send();
  });
}
