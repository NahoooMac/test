import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import { adminUserStatusSchema } from '@dp/shared';
import type { Db } from '../../db/client.ts';
import { deliveryOffers, riders, users } from '../../db/schema.ts';
import { riderPhotoUrl } from '../riders/photo.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, parseInput } from '../../shared/errors.ts';
import type { Authenticator } from '../auth/http.ts';
import type { SessionService } from '../auth/sessions.ts';
import { audit } from './audit.ts';

/** Typed numbers often start with the local 0 or the 251 country code; stored ones are +2519…. */
const phoneNeedle = (digits: string) => digits.replace(/^(251|0)/, '').slice(-9);

const listQuery = z.object({ q: z.string().trim().max(40).optional() });

export async function adminUserRoutes(
  app: FastifyInstance,
  deps: {
    db: Db;
    clock: Clock;
    auth: Authenticator;
    sessions: SessionService;
    closeUserStreams: (userId: string) => void;
  },
) {
  const { db, clock, auth, sessions, closeUserStreams } = deps;

  app.get('/admin/users', async (req, reply) => {
    await auth.require(req, reply, 'admin');
    const { q } = parseInput(listQuery, req.query);
    const digits = q?.replace(/\D/g, '') ?? '';
    const rows = await db
      .select({ u: users, kycStatus: riders.kycStatus, photoAt: riders.photoUpdatedAt })
      .from(users)
      .leftJoin(riders, eq(riders.userId, users.id))
      .where(
        q
          ? or(
              // Escape LIKE wildcards so a typed % or _ is matched literally.
              ilike(users.fullName, `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`),
              digits.length >= 3 ? ilike(users.phoneE164, `%${phoneNeedle(digits)}%`) : undefined,
            )
          : undefined,
      )
      .orderBy(desc(users.createdAt))
      .limit(100);
    return rows.map(({ u, kycStatus, photoAt }) => ({
      id: u.id,
      phone: u.phoneE164,
      fullName: u.fullName,
      role: u.role,
      status: u.status,
      // Riders (and applicants): identity verification state, for the "View KYC" link.
      kycStatus: kycStatus ?? null,
      photoUrl: riderPhotoUrl(u.id, photoAt),
      createdAt: u.createdAt.toISOString(),
    }));
  });

  /** Suspending signs the user out everywhere and takes a rider offline. */
  app.post<{ Params: { id: string } }>('/admin/users/:id/status', async (req, reply) => {
    const { user: admin } = await auth.require(req, reply, 'admin');
    const { status, reason } = parseInput(adminUserStatusSchema, req.body);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id))
      throw new AppError(404, 'NOT_FOUND', 'User not found.');
    if (req.params.id === admin.id) {
      throw new AppError(409, 'SELF_ACTION', 'You cannot change your own account status.');
    }
    const now = clock.now();
    const [target] = await db.select().from(users).where(eq(users.id, req.params.id));
    if (!target) throw new AppError(404, 'NOT_FOUND', 'User not found.');
    await db.transaction(async (tx) => {
      await tx.update(users).set({ status, updatedAt: now }).where(eq(users.id, target.id));
      if (status === 'suspended' && target.role === 'rider') {
        await tx
          .update(riders)
          .set({ isOnline: false, updatedAt: now })
          .where(eq(riders.userId, target.id));
        await tx
          .update(deliveryOffers)
          .set({ status: 'withdrawn', respondedAt: now })
          .where(and(eq(deliveryOffers.riderId, target.id), eq(deliveryOffers.status, 'offered')));
      }
      await audit(
        tx,
        admin.id,
        `user.${status === 'suspended' ? 'suspend' : 'reinstate'}`,
        { type: 'user', id: target.id },
        { reason },
      );
    });
    if (status === 'suspended') {
      await sessions.revokeAllForUser(target.id, 'suspended_by_admin');
      closeUserStreams(target.id);
    }
    return reply.status(204).send();
  });
}
