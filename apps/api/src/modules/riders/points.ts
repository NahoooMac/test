// Rider points: start at 50, +1 per delivered job, −3 per rider-responsible cancellation, audited
// admin corrections. Every row is written inside the transaction that caused it, and unique
// indexes make each award or deduction once-only, so retries and duplicate events can't repeat it.
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  POINTS_COMPLETION,
  POINTS_RIDER_CANCELLATION,
  POINTS_START,
  type PointsEntry,
} from '@dp/shared';
import type { Db, Tx } from '../../db/client.ts';
import { AppError } from '../../shared/errors.ts';
import { audit } from '../admin/audit.ts';
import { deliveries, riderPoints, riders } from '../../db/schema.ts';

export async function ensureStartingPoints(tx: Tx, riderId: string, now: Date) {
  await tx
    .insert(riderPoints)
    .values({ riderId, type: 'initial', delta: POINTS_START, reason: 'Starting points', createdAt: now })
    .onConflictDoNothing();
}

export async function awardCompletion(tx: Tx, riderId: string, deliveryId: string, now: Date) {
  await tx
    .insert(riderPoints)
    .values({
      riderId,
      deliveryId,
      type: 'completion',
      delta: POINTS_COMPLETION,
      reason: 'Delivery completed',
      createdAt: now,
    })
    .onConflictDoNothing();
}

/** Only for cancellations caused by the rider (release, or an admin's rider-fault cancellation). */
export async function penalizeRiderCancellation(
  tx: Tx,
  riderId: string,
  deliveryId: string,
  reason: string,
  now: Date,
  createdBy: string | null = null,
) {
  await tx
    .insert(riderPoints)
    .values({
      riderId,
      deliveryId,
      type: 'rider_cancellation',
      delta: POINTS_RIDER_CANCELLATION,
      reason,
      createdBy,
      createdAt: now,
    })
    .onConflictDoNothing();
}

export async function pointsBalance(db: Tx, riderId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${riderPoints.delta}), 0)`.mapWith(Number) })
    .from(riderPoints)
    .where(eq(riderPoints.riderId, riderId));
  return row?.total ?? 0;
}

export async function pointsHistory(db: Tx, riderId: string, limit = 50): Promise<PointsEntry[]> {
  const rows = await db
    .select({ p: riderPoints, code: deliveries.publicCode })
    .from(riderPoints)
    .leftJoin(deliveries, eq(deliveries.id, riderPoints.deliveryId))
    .where(eq(riderPoints.riderId, riderId))
    .orderBy(desc(riderPoints.createdAt))
    .limit(limit);
  return rows.map(({ p, code }) => ({
    id: p.id,
    type: p.type,
    delta: p.delta,
    reason: p.reason,
    deliveryCode: code ?? null,
    createdAt: p.createdAt.toISOString(),
  }));
}

export async function recentRiderCancellations(db: Tx, riderId: string, since: Date) {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(riderPoints)
    .where(
      and(
        eq(riderPoints.riderId, riderId),
        eq(riderPoints.type, 'rider_cancellation'),
        gte(riderPoints.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}

/** Audited admin correction. Never edits past rows: it adds a new, signed adjustment row. */
export async function adjustPoints(
  db: Db,
  adminId: string,
  riderId: string,
  input: { delta: number; reason: string; deliveryCode?: string | undefined },
  now: Date,
) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select({ id: riders.userId }).from(riders).where(eq(riders.userId, riderId));
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Rider not found.');
    let deliveryId: string | null = null;
    if (input.deliveryCode) {
      const [d] = await tx
        .select({ id: deliveries.id })
        .from(deliveries)
        .where(sql`upper(${deliveries.publicCode}) = upper(${input.deliveryCode})`);
      if (!d) {
        throw new AppError(400, 'VALIDATION_FAILED', 'No delivery has that code.', {
          fields: { deliveryCode: 'No delivery has that code.' },
        });
      }
      deliveryId = d.id;
    }
    await tx.insert(riderPoints).values({
      riderId,
      deliveryId,
      type: 'adjustment',
      delta: input.delta,
      reason: input.reason,
      createdBy: adminId,
      createdAt: now,
    });
    await audit(tx, adminId, 'points.adjust', { type: 'rider', id: riderId }, {
      delta: input.delta,
      reason: input.reason,
      deliveryCode: input.deliveryCode ?? null,
    });
    return pointsBalance(tx, riderId);
  });
}
