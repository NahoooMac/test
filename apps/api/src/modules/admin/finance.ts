import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  pricingRuleInputSchema,
  resolvePaymentSchema,
  settlementSchema,
  verifyPaymentSchema,
} from '@dp/shared';
import type { Db } from '../../db/client.ts';
import { pricingRules, riders, users } from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, parseInput } from '../../shared/errors.ts';
import type { Authenticator } from '../auth/http.ts';
import type { PaymentService } from '../payments/service.ts';
import type { Realtime } from '../realtime/hub.ts';
import { audit, auditFor } from './audit.ts';

const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

/** Escapes a CSV field (quotes, commas, newlines) and neutralises spreadsheet formulas. */
function csv(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function adminFinanceRoutes(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Authenticator; payments: PaymentService; realtime: Realtime },
) {
  const { db, clock, auth, payments, realtime } = deps;

  // ── Reconciliation and settlements ─────────────────────────────────────────

  app.get('/admin/reconciliation', async (req, reply) => {
    await auth.require(req, reply, 'admin');
    reply.header('Cache-Control', 'no-store');
    return payments.reconciliation();
  });

  app.get('/admin/reconciliation.csv', async (req, reply) => {
    await auth.require(req, reply, 'admin');
    const { riders: rows } = await payments.reconciliation();
    const header = [
      'rider',
      'phone',
      'plate',
      'deliveries',
      'commission_owed_etb',
      'settled_etb',
      'adjustments_etb',
      'outstanding_etb',
      'last_settlement',
    ];
    const lines = rows.map((r) =>
      [
        r.name,
        // Without the leading "+" so spreadsheets read it as a number, not a formula.
        r.phone.replace(/^\+/, ''),
        r.plate,
        r.deliveries,
        r.commission,
        r.settled,
        r.adjustments,
        r.balance,
        r.lastSettlementAt,
      ]
        .map(csv)
        .join(','),
    );
    const date = clock.now().toISOString().slice(0, 10);
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="reconciliation-${date}.csv"`);
    return [header.join(','), ...lines].join('\n') + '\n';
  });

  app.get<{ Params: { id: string } }>('/admin/riders/:id/ledger', async (req, reply) => {
    await auth.require(req, reply, 'admin');
    if (!isUuid(req.params.id)) throw new AppError(404, 'NOT_FOUND', 'Rider not found.');
    const [balance, entries, log] = await Promise.all([
      payments.balance(req.params.id),
      payments.entries(req.params.id, 200),
      auditFor(db, 'rider', req.params.id),
    ]);
    return {
      balance,
      entries: entries.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
      audit: log,
    };
  });

  app.post<{ Params: { id: string } }>('/admin/riders/:id/settlements', async (req, reply) => {
    const { user: admin } = await auth.require(req, reply, 'admin');
    const key = idempotencyKeySchema.safeParse(req.headers['idempotency-key']);
    if (!key.success) {
      throw new AppError(
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Missing or invalid Idempotency-Key header.',
      );
    }
    if (!isUuid(req.params.id)) throw new AppError(404, 'NOT_FOUND', 'Rider not found.');
    const [rider] = await db
      .select({ id: riders.userId })
      .from(riders)
      .where(eq(riders.userId, req.params.id));
    if (!rider) throw new AppError(404, 'NOT_FOUND', 'Rider not found.');
    const input = parseInput(settlementSchema, req.body);
    const result = await payments.settle(req.params.id, admin.id, input, key.data);
    if (result.created) {
      await audit(
        db,
        admin.id,
        'rider.settlement',
        { type: 'rider', id: req.params.id },
        { amount: input.amount, method: input.method, reference: input.reference },
      );
      realtime.notifyUser(req.params.id, 'rider');
    }
    reply.status(result.created ? 201 : 200);
    return result;
  });

  app.post<{ Params: { id: string } }>('/admin/payments/:id/resolve', async (req, reply) => {
    const { user: admin } = await auth.require(req, reply, 'admin');
    if (!isUuid(req.params.id)) throw new AppError(404, 'NOT_FOUND', 'Payment not found.');
    const { status, method, note } = parseInput(resolvePaymentSchema, req.body);
    const row = await payments.resolve(req.params.id, admin.id, status, method, note);
    await audit(
      db,
      admin.id,
      `payment.${status}`,
      { type: 'delivery', id: row.deliveryId },
      { paymentId: row.id, kind: row.kind, amount: row.amount, method, note },
    );
    await realtime.deliveryChanged(row.deliveryId);
    return reply.status(204).send();
  });

  // Independent check of a Telebirr / CBE Birr payment against the statement (audited).
  app.post<{ Params: { id: string } }>('/admin/payments/:id/verify', async (req, reply) => {
    const { user: admin } = await auth.require(req, reply, 'admin');
    if (!isUuid(req.params.id)) throw new AppError(404, 'NOT_FOUND', 'Payment not found.');
    const { decision, note } = parseInput(verifyPaymentSchema, req.body);
    const row = await payments.verify(req.params.id, admin.id, decision, note);
    await audit(
      db,
      admin.id,
      `payment.${decision === 'verify' ? 'verified' : 'verification_rejected'}`,
      { type: 'delivery', id: row.deliveryId },
      { paymentId: row.id, amount: row.amount, method: row.method, reference: row.reference, note },
    );
    await realtime.deliveryChanged(row.deliveryId);
    return reply.status(204).send();
  });

  // ── Pricing ───────────────────────────────────────────────────────────────

  app.get('/admin/pricing', async (req, reply) => {
    await auth.require(req, reply, 'admin');
    const rows = await db
      .select({ r: pricingRules, by: users.fullName })
      .from(pricingRules)
      .leftJoin(users, eq(users.id, pricingRules.createdBy))
      .orderBy(desc(pricingRules.effectiveFrom))
      .limit(100);
    return rows.map(({ r, by }) => ({
      id: r.id,
      vehicleType: r.vehicleType,
      baseFare: r.baseFare,
      perKm: r.perKm,
      minimumFare: r.minimumFare,
      maxDistanceKm: r.maxDistanceKm,
      commissionRate: r.commissionRate,
      cancellationFeeAfterArrival: r.cancellationFeeAfterArrival,
      perMinute: r.perMinute,
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveTo: r.effectiveTo?.toISOString() ?? null,
      current: r.effectiveTo === null,
      createdBy: by,
    }));
  });

  /** New rates take effect immediately for new bookings; existing deliveries keep their rule. */
  app.post('/admin/pricing', async (req, reply) => {
    const { user: admin } = await auth.require(req, reply, 'admin');
    const input = parseInput(pricingRuleInputSchema, req.body);
    const now = clock.now();
    const id = await db.transaction(async (tx) => {
      await tx
        .update(pricingRules)
        .set({ effectiveTo: now })
        .where(
          and(eq(pricingRules.vehicleType, input.vehicleType), isNull(pricingRules.effectiveTo)),
        );
      const [rule] = await tx
        .insert(pricingRules)
        .values({
          vehicleType: input.vehicleType,
          baseFare: Number(input.baseFare).toFixed(2),
          perKm: Number(input.perKm).toFixed(2),
          minimumFare: Number(input.minimumFare).toFixed(2),
          maxDistanceKm: input.maxDistanceKm,
          commissionRate: input.commissionRate.toFixed(4),
          cancellationFeeAfterArrival: Number(input.cancellationFeeAfterArrival).toFixed(2),
          perMinute: Number(input.perMinute).toFixed(2),
          effectiveFrom: now,
          createdBy: admin.id,
        })
        .returning({ id: pricingRules.id });
      await audit(
        tx,
        admin.id,
        'pricing.update',
        { type: 'pricing', id: input.vehicleType },
        { ...input, ruleId: rule!.id },
      );
      return rule!.id;
    });
    reply.status(201);
    return { id };
  });
}
