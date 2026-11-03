// Prepaid commission wallet, kept on the existing append-only rider_ledger (no second money system):
//   ledger amount + = the rider owes the platform (commission), − = paid in (top-up / settlement)
//   wallet balance  = −SUM(amount)  (what the rider has prepaid; negative = in debt)
// Commission is charged once per delivery, only when it is delivered. A rider may take a job only
// while balance ≥ minimum and balance − that job's commission ≥ −debt limit; with one active job
// per rider, that check keeps the balance from ever crossing the debt limit.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  fromSantim,
  toSantim,
  type PlatformSettings,
  type RiderWallet,
  type WalletEligibility,
  type WalletEntry,
  type WalletTopup,
  type topupRequestSchema,
} from '@dp/shared';
import { ACTIVE_RIDER_STATUSES } from '@dp/shared';
import type { z } from 'zod';
import type { Db, Tx } from '../../db/client.ts';
import { deliveries, riderLedger, riders, walletTopups } from '../../db/schema.ts';
import { AppError, isUniqueViolation } from '../../shared/errors.ts';
import { audit } from '../admin/audit.ts';
import { getSettings } from '../platform/settings.ts';

/** Serialises every balance-changing step for one rider (claims, commission, top-ups, adjustments). */
export async function lockRider(tx: Tx, riderId: string) {
  await tx.execute(sql`select 1 from ${riders} where ${riders.userId} = ${riderId} for update`);
}

export async function walletBalanceSantim(tx: Tx, riderId: string): Promise<number> {
  const [row] = await tx
    .select({ owed: sql<string>`coalesce(sum(${riderLedger.amount}), 0)::numeric(12,2)::text` })
    .from(riderLedger)
    .where(eq(riderLedger.riderId, riderId));
  return -toSantim(row?.owed ?? '0.00');
}

export function eligibilityFrom(balance: number, s: PlatformSettings): WalletEligibility {
  const min = toSantim(s.walletMinBalance);
  const limit = toSantim(s.walletDebtLimit);
  const issue = balance <= -limit ? 'at_debt_limit' : balance < min ? 'below_minimum' : null;
  return {
    balance: fromSantim(balance),
    minBalance: s.walletMinBalance,
    debtLimit: s.walletDebtLimit,
    canTakeWork: issue === null,
    issue,
  };
}

export async function walletEligibility(tx: Tx, riderId: string): Promise<WalletEligibility> {
  return eligibilityFrom(await walletBalanceSantim(tx, riderId), await getSettings(tx));
}

/**
 * Throws unless the rider can take a job with this commission. Call inside the claim/accept/assign
 * transaction, after lockRider, so two requests can't both pass.
 */
export async function assertWalletAllowsJob(tx: Tx, riderId: string, commission: string) {
  const s = await getSettings(tx);
  const balance = await walletBalanceSantim(tx, riderId);
  const e = eligibilityFrom(balance, s);
  const afterJob = balance - toSantim(commission);
  if (!e.canTakeWork || afterJob < -toSantim(s.walletDebtLimit)) {
    throw new AppError(
      409,
      'WALLET_LOW',
      'Top up your commission wallet before taking new jobs.',
      {
        details: {
          balance: e.balance,
          minBalance: s.walletMinBalance,
          debtLimit: s.walletDebtLimit,
          commission,
        },
      },
    );
  }
}

/**
 * Deducts this delivery's commission (as recorded on the delivery at booking, never a client
 * value). Runs in the same transaction as the move to `delivered`, so the delivery is never marked
 * done without its commission record, and the unique index makes a retry a no-op.
 */
export async function chargeCommission(
  tx: Tx,
  d: { id: string; riderId: string; publicCode: string; fareAmount: string; commissionAmount: string; commissionRate: string },
  now: Date,
) {
  if (toSantim(d.commissionAmount) <= 0) return;
  await lockRider(tx, d.riderId);
  await tx
    .insert(riderLedger)
    .values({
      riderId: d.riderId,
      type: 'commission',
      amount: d.commissionAmount,
      deliveryId: d.id,
      note: `Commission ${Math.round(Number(d.commissionRate) * 10_000) / 100}% on ${d.fareAmount} ETB (#${d.publicCode})`,
      createdBy: d.riderId,
      createdAt: now,
    })
    .onConflictDoNothing({
      target: riderLedger.deliveryId,
      where: sql`${riderLedger.type} = 'commission'`,
    });
}

/** Commission the rider's current active job will cost when delivered (reserved headroom). */
async function pendingCommissionSantim(tx: Tx, riderId: string): Promise<number> {
  const [row] = await tx
    .select({ c: deliveries.commissionAmount })
    .from(deliveries)
    .where(
      and(eq(deliveries.riderId, riderId), inArray(deliveries.status, [...ACTIVE_RIDER_STATUSES])),
    )
    .limit(1);
  return row ? toSantim(row.c) : 0;
}

// ── Rider views and top-up requests ─────────────────────────────────────────

const topupDto = (t: typeof walletTopups.$inferSelect): WalletTopup => ({
  id: t.id,
  amount: t.amount,
  method: t.method as 'telebirr' | 'cbe_birr',
  reference: t.reference,
  status: t.status,
  reviewNote: t.reviewNote,
  createdAt: t.createdAt.toISOString(),
  reviewedAt: t.reviewedAt?.toISOString() ?? null,
});

export async function walletEntries(db: Tx, riderId: string, limit = 50): Promise<WalletEntry[]> {
  const rows = await db
    .select({ l: riderLedger, code: deliveries.publicCode })
    .from(riderLedger)
    .leftJoin(deliveries, eq(deliveries.id, riderLedger.deliveryId))
    .where(eq(riderLedger.riderId, riderId))
    .orderBy(desc(riderLedger.createdAt))
    .limit(limit);
  return rows.map(({ l, code }) => ({
    id: l.id,
    type: l.type,
    amount: fromSantim(-toSantim(l.amount)),
    note: l.note,
    method: l.method,
    reference: l.reference,
    deliveryCode: code ?? null,
    createdAt: l.createdAt.toISOString(),
  }));
}

export async function riderWallet(db: Db, riderId: string): Promise<RiderWallet> {
  const [e, entries, topups] = await Promise.all([
    walletEligibility(db, riderId),
    walletEntries(db, riderId),
    db
      .select()
      .from(walletTopups)
      .where(eq(walletTopups.riderId, riderId))
      .orderBy(desc(walletTopups.createdAt))
      .limit(20),
  ]);
  return { ...e, entries, topups: topups.map(topupDto) };
}

/** A claim that money was sent. Nothing is credited until an admin verifies it. */
export async function requestTopup(
  db: Db,
  riderId: string,
  input: z.output<typeof topupRequestSchema>,
  now: Date,
): Promise<WalletTopup> {
  try {
    const [row] = await db
      .insert(walletTopups)
      .values({
        riderId,
        amount: Number(input.amount).toFixed(2),
        method: input.method,
        reference: input.reference.toUpperCase(),
        createdAt: now,
      })
      .returning();
    return topupDto(row!);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, 'DUPLICATE_REFERENCE', 'This transaction ID was already submitted.', {
        fields: { reference: 'This transaction ID was already submitted.' },
      });
    }
    throw err;
  }
}

// ── Admin ────────────────────────────────────────────────────────────────────

/** Verify credits the wallet exactly once (idempotency key per top-up); reject credits nothing. */
export async function reviewTopup(
  db: Db,
  adminId: string,
  topupId: string,
  decision: 'verify' | 'reject',
  note: string | undefined,
  now: Date,
) {
  return db.transaction(async (tx) => {
    const [t] = await tx
      .update(walletTopups)
      .set({
        status: decision === 'verify' ? 'verified' : 'rejected',
        reviewedBy: adminId,
        reviewedAt: now,
        reviewNote: note ?? null,
      })
      .where(and(eq(walletTopups.id, topupId), eq(walletTopups.status, 'pending')))
      .returning();
    if (!t) throw new AppError(409, 'NOT_PENDING', 'This top-up was already reviewed.');
    if (decision === 'verify') {
      await lockRider(tx, t.riderId);
      await tx.insert(riderLedger).values({
        riderId: t.riderId,
        type: 'settlement',
        amount: fromSantim(-toSantim(t.amount)),
        method: t.method,
        reference: t.reference,
        note: `Top-up verified${note ? `: ${note}` : ''}`,
        idempotencyKey: `topup:${t.id}`,
        createdBy: adminId,
        createdAt: now,
      });
    }
    await audit(tx, adminId, `wallet.topup_${decision}`, { type: 'rider', id: t.riderId }, {
      topupId: t.id,
      amount: t.amount,
      method: t.method,
      reference: t.reference,
      note: note ?? null,
    });
    return topupDto(t);
  });
}

/**
 * Audited manual correction (+ credit / − debit, rider's point of view). A debit may not take the
 * wallet past the debt limit, counting the commission the rider's current job will cost.
 */
export async function adjustWallet(
  db: Db,
  adminId: string,
  riderId: string,
  amount: string,
  reason: string,
  now: Date,
) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select({ id: riders.userId }).from(riders).where(eq(riders.userId, riderId));
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Rider not found.');
    await lockRider(tx, riderId);
    const delta = toSantim(amount);
    if (delta < 0) {
      const s = await getSettings(tx);
      const after =
        (await walletBalanceSantim(tx, riderId)) - (await pendingCommissionSantim(tx, riderId)) + delta;
      if (after < -toSantim(s.walletDebtLimit)) {
        throw new AppError(409, 'OVER_DEBT_LIMIT', 'This debit would take the wallet past the debt limit.');
      }
    }
    await tx.insert(riderLedger).values({
      riderId,
      type: 'adjustment',
      amount: fromSantim(-delta),
      note: reason,
      createdBy: adminId,
      createdAt: now,
    });
    await audit(tx, adminId, 'wallet.adjust', { type: 'rider', id: riderId }, { amount, reason });
    return eligibilityFrom(await walletBalanceSantim(tx, riderId), await getSettings(tx));
  });
}
