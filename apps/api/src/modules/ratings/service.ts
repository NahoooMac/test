// Customer ratings of riders: 1–5 stars, one per delivered delivery, by that delivery's customer.
// Riders can report a rating they think is abusive; admins keep or remove it (audited). Removed
// ratings stop counting. Matching uses a Bayesian average (see dispatch/matching.ts).
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { MyRating, ratingSchema } from '@dp/shared';
import type { z } from 'zod';
import type { Db } from '../../db/client.ts';
import { deliveries, deliveryRatings, users } from '../../db/schema.ts';
import { AppError, isUniqueViolation } from '../../shared/errors.ts';
import { audit } from '../admin/audit.ts';

export async function rateDelivery(
  db: Db,
  customerId: string,
  deliveryId: string,
  input: z.output<typeof ratingSchema>,
  now: Date,
): Promise<MyRating> {
  if (!/^[0-9a-f-]{36}$/i.test(deliveryId)) throw new AppError(404, 'NOT_FOUND', 'Not found.');
  const [d] = await db
    .select({ status: deliveries.status, riderId: deliveries.riderId, customerId: deliveries.customerId })
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId));
  if (!d || d.customerId !== customerId) throw new AppError(404, 'NOT_FOUND', 'Not found.');
  if (d.status !== 'delivered' || !d.riderId) {
    throw new AppError(409, 'NOT_RATEABLE', 'Only completed deliveries can be rated.');
  }
  try {
    const [row] = await db
      .insert(deliveryRatings)
      .values({
        deliveryId,
        riderId: d.riderId,
        customerId,
        stars: input.stars,
        comment: input.comment || null,
        createdAt: now,
      })
      .returning();
    return { stars: row!.stars, comment: row!.comment, createdAt: row!.createdAt.toISOString() };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, 'ALREADY_RATED', 'You already rated this delivery.');
    }
    throw err;
  }
}

export async function myRating(db: Db, customerId: string, deliveryId: string): Promise<MyRating | null> {
  const [r] = await db
    .select()
    .from(deliveryRatings)
    .where(and(eq(deliveryRatings.deliveryId, deliveryId), eq(deliveryRatings.customerId, customerId)));
  return r ? { stars: r.stars, comment: r.comment, createdAt: r.createdAt.toISOString() } : null;
}

/** A rider flags a rating on one of their own deliveries for admin review. */
export async function reportRating(db: Db, riderId: string, deliveryId: string, reason: string, now: Date) {
  const [r] = await db
    .update(deliveryRatings)
    .set({ status: 'reported', reportReason: reason, reportedAt: now })
    .where(
      and(
        eq(deliveryRatings.deliveryId, deliveryId),
        eq(deliveryRatings.riderId, riderId),
        eq(deliveryRatings.status, 'active'),
      ),
    )
    .returning({ id: deliveryRatings.deliveryId });
  if (!r) throw new AppError(409, 'NOT_REPORTABLE', 'This rating cannot be reported.');
}

export async function riderRatings(db: Db, riderId: string) {
  const rows = await db
    .select({ r: deliveryRatings, code: deliveries.publicCode })
    .from(deliveryRatings)
    .innerJoin(deliveries, eq(deliveries.id, deliveryRatings.deliveryId))
    .where(and(eq(deliveryRatings.riderId, riderId), inArray(deliveryRatings.status, ['active', 'reported'])))
    .orderBy(desc(deliveryRatings.createdAt))
    .limit(50);
  return rows.map(({ r, code }) => ({
    deliveryId: r.deliveryId,
    code,
    stars: r.stars,
    comment: r.comment,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Admin review list. `suspicious` adds simple signals: the customer rated this rider 3+ times in
 * 7 days, or left a 1-star rating with no comment.
 */
export async function adminRatings(db: Db, status: 'active' | 'reported' | 'removed' | undefined) {
  const rider = sql<string | null>`(select full_name from ${users} where id = "delivery_ratings"."rider_id")`;
  const customer = sql<string | null>`(select full_name from ${users} where id = "delivery_ratings"."customer_id")`;
  const repeat = sql<number>`(select count(*) from ${deliveryRatings} r2 where r2.customer_id = "delivery_ratings"."customer_id" and r2.rider_id = "delivery_ratings"."rider_id" and r2.created_at > "delivery_ratings"."created_at" - interval '7 days' and r2.created_at <= "delivery_ratings"."created_at" + interval '7 days')`;
  const rows = await db
    .select({ r: deliveryRatings, code: deliveries.publicCode, rider, customer, repeat: repeat.mapWith(Number) })
    .from(deliveryRatings)
    .innerJoin(deliveries, eq(deliveries.id, deliveryRatings.deliveryId))
    .where(status ? eq(deliveryRatings.status, status) : undefined)
    .orderBy(desc(deliveryRatings.createdAt))
    .limit(200);
  return rows.map(({ r, code, rider: riderName, customer: customerName, repeat: n }) => ({
    deliveryId: r.deliveryId,
    code,
    riderId: r.riderId,
    riderName,
    customerName,
    stars: r.stars,
    comment: r.comment,
    status: r.status,
    reportReason: r.reportReason,
    reportedAt: r.reportedAt?.toISOString() ?? null,
    reviewNote: r.reviewNote,
    createdAt: r.createdAt.toISOString(),
    flags: [
      ...(n >= 3 ? ['repeat_customer'] : []),
      ...(r.stars === 1 && !r.comment ? ['one_star_no_comment'] : []),
    ],
  }));
}

export async function reviewRating(
  db: Db,
  adminId: string,
  deliveryId: string,
  decision: 'keep' | 'remove',
  note: string,
  now: Date,
) {
  await db.transaction(async (tx) => {
    const [r] = await tx
      .update(deliveryRatings)
      .set({
        status: decision === 'keep' ? 'active' : 'removed',
        reviewedBy: adminId,
        reviewedAt: now,
        reviewNote: note,
      })
      .where(
        and(eq(deliveryRatings.deliveryId, deliveryId), inArray(deliveryRatings.status, ['active', 'reported'])),
      )
      .returning();
    if (!r) throw new AppError(409, 'NOT_REVIEWABLE', 'This rating was already removed.');
    await audit(tx, adminId, `rating.${decision}`, { type: 'rider', id: r.riderId }, {
      deliveryId,
      stars: r.stars,
      note,
    });
  });
}
