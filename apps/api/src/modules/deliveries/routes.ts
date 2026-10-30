import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  cancelDeliverySchema,
  createDeliverySchema,
  quoteRequestSchema,
  type Delivery,
  type DeliverySummary,
  type Quote,
} from '@dp/shared';
import type { Db } from '../../db/client.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, parseInput, tooManyRequests } from '../../shared/errors.ts';
import { consume } from '../../shared/rate-limit.ts';
import type { Authenticator } from '../auth/http.ts';
import type { DeliveryService } from './service.ts';

const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);

export async function deliveryRoutes(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Authenticator; deliveries: DeliveryService },
) {
  const { db, clock, auth, deliveries } = deps;

  app.post('/deliveries/quote', async (req, reply): Promise<Quote> => {
    await auth.require(req, reply, 'customer');
    return deliveries.quote(parseInput(quoteRequestSchema, req.body));
  });

  app.post('/deliveries', async (req, reply): Promise<Delivery> => {
    const { user } = await auth.require(req, reply, 'customer');
    const key = idempotencyKeySchema.safeParse(req.headers['idempotency-key']);
    if (!key.success) {
      throw new AppError(
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Missing or invalid Idempotency-Key header.',
      );
    }
    const input = parseInput(createDeliverySchema, req.body);

    const limit = await consume(
      db,
      { key: `deliveries:create1h:${user.id}`, windowSec: 3600, limit: 20 },
      clock.now(),
    );
    if (!limit.allowed) throw tooManyRequests(limit.retryAfterSec);

    const result = await deliveries.create(user.id, input, key.data);
    reply.status(result.created ? 201 : 200);
    return result.delivery;
  });

  app.get('/deliveries', async (req, reply): Promise<DeliverySummary[]> => {
    const { user } = await auth.require(req, reply, 'customer');
    return deliveries.listForCustomer(user.id);
  });

  app.get<{ Params: { id: string } }>('/deliveries/:id', async (req, reply): Promise<Delivery> => {
    const { user } = await auth.require(req, reply, 'customer');
    return deliveries.getForCustomer(user.id, req.params.id);
  });

  app.post<{ Params: { id: string } }>(
    '/deliveries/:id/cancel',
    async (req, reply): Promise<Delivery> => {
      const { user } = await auth.require(req, reply, 'customer');
      const body = parseInput(cancelDeliverySchema, req.body);
      return deliveries.cancelByCustomer(user.id, req.params.id, body.reason);
    },
  );
}
