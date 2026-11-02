import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  KYC_DOCUMENT_KINDS,
  KYC_STATUSES,
  adminKycDecisionSchema,
  kycUploadSchema,
  type AdminKycDetail,
  type AdminKycRow,
  type RiderKyc,
} from '@dp/shared';
import type { Db } from '../../db/client.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, parseInput, tooManyRequests } from '../../shared/errors.ts';
import { consume } from '../../shared/rate-limit.ts';
import type { Authenticator } from '../auth/http.ts';
import type { KycService } from './service.ts';

const kindParam = z.object({ kind: z.enum(KYC_DOCUMENT_KINDS) });
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({ status: z.enum(KYC_STATUSES).optional() });

const NOT_FOUND = () => new AppError(404, 'NOT_FOUND', 'Not found.');
const parseParams = <S extends z.ZodType>(schema: S, params: unknown): z.infer<S> => {
  const r = schema.safeParse(params);
  if (!r.success) throw NOT_FOUND();
  return r.data;
};

export async function kycRoutes(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Authenticator; kyc: KycService },
) {
  const { db, clock, auth, kyc } = deps;

  // ── Rider ──────────────────────────────────────────────────────────────────

  app.get('/rider/kyc', async (req, reply): Promise<RiderKyc> => {
    const { user } = await auth.require(req, reply, 'rider');
    reply.header('Cache-Control', 'no-store');
    return kyc.view(user.id);
  });

  // One photo per request (≈1 MB of base64), so this route alone gets a larger body limit.
  app.put<{ Params: { kind: string } }>(
    '/rider/kyc/documents/:kind',
    { bodyLimit: 1_400_000 },
    async (req, reply): Promise<RiderKyc> => {
      const { user } = await auth.require(req, reply, 'rider');
      const { kind } = parseParams(kindParam, req.params);
      const limit = await consume(
        db,
        { key: `kyc:upload1h:${user.id}`, windowSec: 3600, limit: 60 },
        clock.now(),
      );
      if (!limit.allowed) throw tooManyRequests(limit.retryAfterSec);
      const { image, capturedAt } = parseInput(kycUploadSchema, req.body);
      reply.header('Cache-Control', 'no-store');
      return kyc.upload(user.id, kind, image, capturedAt);
    },
  );

  app.post('/rider/kyc/submit', async (req, reply): Promise<RiderKyc> => {
    const { user } = await auth.require(req, reply, 'rider');
    return kyc.submit(user.id);
  });

  // ── Admin ──────────────────────────────────────────────────────────────────

  app.get('/admin/kyc', async (req, reply): Promise<AdminKycRow[]> => {
    await auth.require(req, reply, 'admin');
    const { status } = parseInput(listQuery, req.query);
    reply.header('Cache-Control', 'no-store');
    return kyc.list(status);
  });

  app.get<{ Params: { id: string } }>(
    '/admin/riders/:id/kyc',
    async (req, reply): Promise<AdminKycDetail> => {
      const { user } = await auth.require(req, reply, 'admin');
      const { id } = parseParams(idParam, req.params);
      reply.header('Cache-Control', 'no-store');
      return kyc.detail(user.id, id);
    },
  );

  // Photos are only ever served here: admin session required, never cached or shared.
  app.get<{ Params: { id: string; kind: string } }>(
    '/admin/riders/:id/kyc/:kind',
    async (req, reply) => {
      await auth.require(req, reply, 'admin');
      const { id } = parseParams(idParam, req.params);
      const { kind } = parseParams(kindParam, req.params);
      const { data, mime } = await kyc.image(id, kind);
      return reply
        .header('Cache-Control', 'no-store, private')
        .header('Content-Disposition', 'inline')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cross-Origin-Resource-Policy', 'same-origin')
        .type(mime)
        .send(data);
    },
  );

  app.post<{ Params: { id: string } }>('/admin/riders/:id/kyc/decision', async (req, reply) => {
    const { user } = await auth.require(req, reply, 'admin');
    const { id } = parseParams(idParam, req.params);
    const input = parseInput(adminKycDecisionSchema, req.body);
    await kyc.decide(user.id, id, input);
    return reply.status(204).send();
  });
}
