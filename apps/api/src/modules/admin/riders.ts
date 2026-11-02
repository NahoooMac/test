import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  RIDER_APPROVAL_STATUSES,
  adminRiderDecisionSchema,
  type RiderApprovalStatus,
} from '@dp/shared';
import type { Db } from '../../db/client.ts';
import { deliveryOffers, riders, users } from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, parseInput } from '../../shared/errors.ts';
import type { Authenticator } from '../auth/http.ts';
import type { Realtime } from '../realtime/hub.ts';
import { audit } from './audit.ts';

const listQuery = z.object({ status: z.enum(RIDER_APPROVAL_STATUSES).optional() });

/** Which decision is allowed from which approval status. */
const DECISIONS: Record<string, { from: RiderApprovalStatus[]; to: RiderApprovalStatus }> = {
  approve: { from: ['pending', 'rejected'], to: 'approved' },
  reject: { from: ['pending'], to: 'rejected' },
  suspend: { from: ['approved'], to: 'suspended' },
  reinstate: { from: ['suspended'], to: 'approved' },
};

export async function adminRiderRoutes(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Authenticator; realtime: Realtime },
) {
  const { db, clock, auth, realtime } = deps;

  app.get('/admin/riders', async (req, reply) => {
    await auth.require(req, reply, 'admin');
    const { status } = parseInput(listQuery, req.query);
    const rows = await db
      .select({ r: riders, u: { phone: users.phoneE164, name: users.fullName } })
      .from(riders)
      .innerJoin(users, eq(users.id, riders.userId))
      .where(status ? eq(riders.approvalStatus, status) : undefined)
      .orderBy(desc(riders.createdAt))
      .limit(200);
    return rows.map(({ r, u }) => ({
      userId: r.userId,
      fullName: u.name,
      phone: u.phone,
      vehicleType: r.vehicleType,
      plateNumber: r.plateNumber,
      approvalStatus: r.approvalStatus,
      kycStatus: r.kycStatus,
      rejectionReason: r.rejectionReason,
      isOnline: r.isOnline,
      locationUpdatedAt: r.locationUpdatedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
    }));
  });

  app.post<{ Params: { id: string } }>('/admin/riders/:id/decision', async (req, reply) => {
    const { user: admin } = await auth.require(req, reply, 'admin');
    const { decision, reason } = parseInput(adminRiderDecisionSchema, req.body);
    const rule = DECISIONS[decision]!;
    if ((decision === 'reject' || decision === 'suspend') && !reason) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid.', {
        fields: { reason: 'Give a reason the rider will see.' },
      });
    }
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id))
      throw new AppError(404, 'NOT_FOUND', 'Rider not found.');
    const now = clock.now();
    const [current] = await db.select().from(riders).where(eq(riders.userId, req.params.id));
    if (!current) throw new AppError(404, 'NOT_FOUND', 'Rider not found.');
    // Approval follows identity verification; it is done from the KYC review, never around it.
    if (rule.to === 'approved' && current.kycStatus !== 'approved') {
      throw new AppError(
        409,
        'KYC_REQUIRED',
        "Review and approve the rider's identity verification first.",
      );
    }
    if (!rule.from.includes(current.approvalStatus)) {
      throw new AppError(
        409,
        'INVALID_DECISION',
        `Cannot ${decision} a rider who is ${current.approvalStatus}.`,
      );
    }
    await db.transaction(async (tx) => {
      await tx
        .update(riders)
        .set({
          approvalStatus: rule.to,
          reviewedBy: admin.id,
          reviewedAt: now,
          rejectionReason: rule.to === 'approved' ? null : (reason ?? null),
          ...(rule.to === 'suspended' ? { isOnline: false } : {}),
          updatedAt: now,
        })
        .where(
          and(eq(riders.userId, req.params.id), eq(riders.approvalStatus, current.approvalStatus)),
        );
      if (rule.to === 'suspended') {
        await tx
          .update(deliveryOffers)
          .set({ status: 'withdrawn', respondedAt: now })
          .where(
            and(eq(deliveryOffers.riderId, req.params.id), eq(deliveryOffers.status, 'offered')),
          );
      }
    });
    await audit(
      db,
      admin.id,
      `rider.${decision}`,
      { type: 'rider', id: req.params.id },
      { reason },
    );
    req.log.info({ admin: admin.id, rider: req.params.id, decision }, 'rider decision');
    realtime.notifyUser(req.params.id, 'rider', { decision });
    realtime.publish({ type: 'ops', data: { riderId: req.params.id } }, { admins: true });
    return reply.status(204).send();
  });
}
