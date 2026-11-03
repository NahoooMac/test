// Payments are made directly to the rider (cash, Telebirr, CBE Birr). The platform records them and
// keeps a ledger of the commission each rider owes. Guarantees, enforced by the database:
//  - one payment row per delivery and kind (re-recording returns the original)
//  - commission is charged to the rider's ledger once per delivery
//  - settlements are idempotent by key and cannot exceed what the rider owes (checked in a
//    transaction that locks the rider row)
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { fromSantim, toSantim, type PaymentMethod } from '@dp/shared';
import type { Db, Tx } from '../../db/client.ts';
import { deliveries, payments, riderLedger, riders, users } from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, isUniqueViolation } from '../../shared/errors.ts';

type DeliveryRow = typeof deliveries.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;

/** Statuses at which a rider may record the fare (the payer must be present). */
const FARE_RECORDABLE: Record<string, Array<DeliveryRow['payer']>> = {
  arrived_pickup: ['sender'],
  picked_up: ['sender', 'receiver'],
  arrived_dropoff: ['sender', 'receiver'],
  returning: ['sender', 'receiver'],
  returned: ['sender', 'receiver'],
};

export class PaymentService {
  private readonly db: Db;
  private readonly clock: Clock;

  constructor(db: Db, clock: Clock) {
    this.db = db;
    this.clock = clock;
  }

  /**
   * The rider records that the fare was paid to them. Charges the commission to their ledger in
   * the same transaction. Calling it again (double tap, retry) returns the existing record.
   */
  async recordFare(
    d: DeliveryRow,
    riderId: string,
    method: PaymentMethod,
    reference: string | undefined,
  ): Promise<PaymentRow> {
    const allowedPayers = FARE_RECORDABLE[d.status];
    if (!allowedPayers) {
      throw new AppError(
        409,
        'PAYMENT_NOT_ALLOWED',
        'The fare can be recorded once you are with the payer.',
      );
    }
    if (!allowedPayers.includes(d.payer)) {
      throw new AppError(
        409,
        'PAYMENT_NOT_ALLOWED',
        'The receiver pays this fare at the drop-off.',
      );
    }
    const now = this.clock.now();
    return this.db.transaction(async (tx) => {
      await tx
        .insert(payments)
        .values({
          deliveryId: d.id,
          kind: 'fare',
          status: 'collected',
          amount: d.fareAmount,
          method,
          payer: d.payer,
          reference: reference || null,
          collectedBy: riderId,
          recordedBy: riderId,
          collectedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: [payments.deliveryId, payments.kind] });
      // Commission is not charged here: it comes out of the rider's wallet only when the
      // delivery is completed (see wallet.chargeCommission), never for failed/returned jobs.
      const [row] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.deliveryId, d.id), eq(payments.kind, 'fare')));
      return row!;
    });
  }

  async farePayment(deliveryId: string): Promise<PaymentRow | null> {
    const [row] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.deliveryId, deliveryId), eq(payments.kind, 'fare')));
    return row ?? null;
  }

  /** Cancellation after the rider arrived: the whole fee goes to the rider, no commission. */
  async recordDueCancellationFee(
    tx: Tx,
    d: { id: string; payer: DeliveryRow['payer'] },
    fee: string,
  ) {
    if (toSantim(fee) <= 0) return;
    const now = this.clock.now();
    await tx
      .insert(payments)
      .values({
        deliveryId: d.id,
        kind: 'cancellation_fee',
        status: 'due',
        amount: fee,
        payer: 'sender', // the customer who cancelled
        note: 'Cancellation after the rider reached the pickup; the fee goes to the rider.',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [payments.deliveryId, payments.kind] });
  }

  async resolve(
    paymentId: string,
    adminId: string,
    status: 'collected' | 'waived',
    method: PaymentMethod | undefined,
    note: string | undefined,
  ): Promise<PaymentRow> {
    if (status === 'collected' && !method) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid.', {
        fields: { method: 'Choose how it was paid.' },
      });
    }
    const now = this.clock.now();
    const [row] = await this.db
      .update(payments)
      .set({
        status,
        method: method ?? null,
        collectedAt: status === 'collected' ? now : null,
        recordedBy: adminId,
        note: note ?? null,
        updatedAt: now,
      })
      .where(and(eq(payments.id, paymentId), eq(payments.status, 'due')))
      .returning();
    if (!row)
      throw new AppError(409, 'NOT_DUE', 'Only payments that are still due can be resolved.');
    return row;
  }

  // ── Ledger ─────────────────────────────────────────────────────────────────

  async balance(riderId: string, tx: Tx = this.db): Promise<string> {
    const [row] = await tx
      .select({ total: sql<string>`coalesce(sum(${riderLedger.amount}), 0)::numeric(12,2)::text` })
      .from(riderLedger)
      .where(eq(riderLedger.riderId, riderId));
    return row?.total ?? '0.00';
  }

  async entries(riderId: string, limit = 100) {
    return this.db
      .select({
        id: riderLedger.id,
        type: riderLedger.type,
        amount: riderLedger.amount,
        method: riderLedger.method,
        reference: riderLedger.reference,
        note: riderLedger.note,
        deliveryCode: deliveries.publicCode,
        createdAt: riderLedger.createdAt,
      })
      .from(riderLedger)
      .leftJoin(deliveries, eq(deliveries.id, riderLedger.deliveryId))
      .where(eq(riderLedger.riderId, riderId))
      .orderBy(desc(riderLedger.createdAt))
      .limit(limit);
  }

  /** Money a rider handed to the platform (cash top-up received by an admin). Idempotent by key. */
  async settle(
    riderId: string,
    adminId: string,
    input: {
      amount: string;
      method: PaymentMethod;
      reference?: string | undefined;
      note?: string | undefined;
    },
    idempotencyKey: string,
  ): Promise<{ created: boolean; balance: string }> {
    const amount = toSantim(input.amount);
    if (amount <= 0) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid.', {
        fields: { amount: 'Must be above 0.' },
      });
    }
    const [existing] = await this.db
      .select()
      .from(riderLedger)
      .where(eq(riderLedger.idempotencyKey, idempotencyKey));
    if (existing) return { created: false, balance: await this.balance(riderId) };

    try {
      await this.db.transaction(async (tx) => {
        // Serialise money movements for this rider (see wallet.lockRider).
        await tx.execute(
          sql`select 1 from ${riders} where ${riders.userId} = ${riderId} for update`,
        );
        // Prepaid wallet: money received from the rider may exceed what they owe; the rest is
        // credit against future commission.
        await tx.insert(riderLedger).values({
          riderId,
          type: 'settlement',
          amount: fromSantim(-amount),
          method: input.method,
          reference: input.reference || null,
          note: input.note || null,
          idempotencyKey,
          createdBy: adminId,
          createdAt: this.clock.now(),
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) return { created: false, balance: await this.balance(riderId) };
      throw err;
    }
    return { created: true, balance: await this.balance(riderId) };
  }

  /** One row per rider with any ledger activity, plus totals. */
  async reconciliation() {
    const rows = await this.db
      .select({
        riderId: riders.userId,
        name: users.fullName,
        phone: users.phoneE164,
        plate: riders.plateNumber,
        vehicleType: riders.vehicleType,
        commission: sql<string>`coalesce(sum(case when ${riderLedger.type} = 'commission' then ${riderLedger.amount} end), 0)::numeric(12,2)::text`,
        settled: sql<string>`coalesce(-sum(case when ${riderLedger.type} = 'settlement' then ${riderLedger.amount} end), 0)::numeric(12,2)::text`,
        adjustments: sql<string>`coalesce(sum(case when ${riderLedger.type} = 'adjustment' then ${riderLedger.amount} end), 0)::numeric(12,2)::text`,
        balance: sql<string>`coalesce(sum(${riderLedger.amount}), 0)::numeric(12,2)::text`,
        deliveries: sql<number>`count(*) filter (where ${riderLedger.type} = 'commission')`.mapWith(
          Number,
        ),
        lastSettlementAt: sql<
          string | null
        >`max(case when ${riderLedger.type} = 'settlement' then ${riderLedger.createdAt} end)`,
      })
      .from(riders)
      .innerJoin(users, eq(users.id, riders.userId))
      .innerJoin(riderLedger, eq(riderLedger.riderId, riders.userId))
      .groupBy(
        riders.userId,
        users.fullName,
        users.phoneE164,
        riders.plateNumber,
        riders.vehicleType,
      )
      .orderBy(desc(sql`coalesce(sum(${riderLedger.amount}), 0)`), asc(users.fullName));

    const sum = (key: 'commission' | 'settled' | 'balance') =>
      fromSantim(rows.reduce((s, r) => s + toSantim(r[key]), 0));
    const [fares] = await this.db
      .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)::numeric(12,2)::text` })
      .from(payments)
      .where(and(eq(payments.kind, 'fare'), eq(payments.status, 'collected')));
    return {
      riders: rows.map((r) => ({
        ...r,
        lastSettlementAt: r.lastSettlementAt ? new Date(r.lastSettlementAt).toISOString() : null,
      })),
      totals: {
        faresCollectedByRiders: fares?.total ?? '0.00',
        commissionOwed: sum('commission'),
        settled: sum('settled'),
        outstanding: sum('balance'),
      },
    };
  }
}
