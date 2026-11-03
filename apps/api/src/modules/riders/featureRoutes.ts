// Rider endpoints for service areas, home, the offer pool, wallet, points/rating and history.
// Every route acts on the signed-in rider only: ids in the URL are checked against ownership in
// the service layer, and nothing a client sends can choose another rider.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  routePointsSchema,
  riderPreferencesSchema,
  topupRequestSchema,
  type DeliveryHistoryDetail,
  type DeliveryHistoryRow,
  type RiderJob,
  type RiderPool,
  type RiderPreferences,
  type RiderStanding,
  type RiderWallet,
  type WalletTopup,
} from '@dp/shared';
import type { Db } from '../../db/client.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, parseInput, tooManyRequests } from '../../shared/errors.ts';
import { consume } from '../../shared/rate-limit.ts';
import type { Authenticator } from '../auth/http.ts';
import { ingestRoute, riderHistory, riderHistoryDetail } from '../history/service.ts';
import { requestTopup, riderWallet } from '../wallet/wallet.ts';
import { riderPool } from './pool.ts';
import { getPreferences, riderStanding, setPreferences } from './preferences.ts';
import type { RiderService } from './service.ts';

type IdParams = { Params: { id: string } };

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
const notFound = () => new AppError(404, 'NOT_FOUND', 'Not found.');

export const historyQuery = z.object({
  group: z.enum(['completed', 'unsuccessful']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(12).optional(),
});

export async function riderFeatureRoutes(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Authenticator; riders: RiderService },
) {
  const { db, clock, auth, riders } = deps;

  // ── Service areas and home (private to the rider and admins) ───────────────

  app.get('/rider/preferences', async (req, reply): Promise<RiderPreferences> => {
    const { user } = await auth.require(req, reply, 'rider');
    reply.header('Cache-Control', 'no-store');
    return getPreferences(db, user.id);
  });

  app.put('/rider/preferences', async (req, reply): Promise<RiderPreferences> => {
    const { user } = await auth.require(req, reply, 'rider');
    const input = parseInput(riderPreferencesSchema, req.body);
    return setPreferences(db, user.id, input, clock.now());
  });

  // ── Offer pool ─────────────────────────────────────────────────────────────

  app.get('/rider/pool', async (req, reply): Promise<RiderPool> => {
    const { user } = await auth.require(req, reply, 'rider');
    reply.header('Cache-Control', 'no-store');
    return riderPool(db, user.id, clock.now());
  });

  app.post<IdParams>('/rider/pool/:id/claim', async (req, reply): Promise<RiderJob> => {
    const { user } = await auth.require(req, reply, 'rider');
    const limit = await consume(
      db,
      { key: `rider:claim:${user.id}`, windowSec: 60, limit: 20 },
      clock.now(),
    );
    if (!limit.allowed) throw tooManyRequests(limit.retryAfterSec);
    return riders.claim(user.id, req.params.id);
  });

  // ── Wallet ─────────────────────────────────────────────────────────────────

  app.get('/rider/wallet', async (req, reply): Promise<RiderWallet> => {
    const { user } = await auth.require(req, reply, 'rider');
    reply.header('Cache-Control', 'no-store');
    return riderWallet(db, user.id);
  });

  // A claim that money was sent; it credits nothing until an admin verifies the transfer.
  app.post('/rider/wallet/topups', async (req, reply): Promise<WalletTopup> => {
    const { user } = await auth.require(req, reply, 'rider');
    const limit = await consume(
      db,
      { key: `rider:topup1h:${user.id}`, windowSec: 3600, limit: 10 },
      clock.now(),
    );
    if (!limit.allowed) throw tooManyRequests(limit.retryAfterSec);
    const input = parseInput(topupRequestSchema, req.body);
    reply.status(201);
    return requestTopup(db, user.id, input, clock.now());
  });

  // ── Points and rating (read-only for riders) ───────────────────────────────

  app.get('/rider/standing', async (req, reply): Promise<RiderStanding> => {
    const { user } = await auth.require(req, reply, 'rider');
    reply.header('Cache-Control', 'no-store');
    return riderStanding(db, user.id);
  });

  // ── Route recording and history ────────────────────────────────────────────

  // Batches of GPS fixes from the rider app's offline queue. Re-sending a batch is harmless.
  app.post<IdParams>(
    '/rider/jobs/:id/route',
    { bodyLimit: 128 * 1024 },
    async (req, reply) => {
      const { user } = await auth.require(req, reply, 'rider');
      if (!isUuid(req.params.id)) throw notFound();
      const limit = await consume(
        db,
        { key: `rider:route:${user.id}`, windowSec: 60, limit: 30 },
        clock.now(),
      );
      if (!limit.allowed) throw tooManyRequests(limit.retryAfterSec);
      const input = parseInput(routePointsSchema, req.body);
      return ingestRoute(db, user.id, req.params.id, input, clock.now());
    },
  );

  app.get('/rider/history', async (req, reply): Promise<DeliveryHistoryRow[]> => {
    const { user } = await auth.require(req, reply, 'rider');
    const f = parseInput(historyQuery, req.query);
    reply.header('Cache-Control', 'no-store');
    return riderHistory(db, user.id, f);
  });

  app.get<IdParams>('/rider/history/:id', async (req, reply): Promise<DeliveryHistoryDetail> => {
    const { user } = await auth.require(req, reply, 'rider');
    reply.header('Cache-Control', 'no-store');
    return riderHistoryDetail(db, user.id, req.params.id);
  });
}
