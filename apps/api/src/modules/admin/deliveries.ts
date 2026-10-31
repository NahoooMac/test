import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  ACTIVE_RIDER_STATUSES,
  DELIVERY_STATUSES,
  adminAssignSchema,
  adminCancelSchema,
} from '@dp/shared';
import type { Db } from '../../db/client.ts';
import {
  contactAttempts,
  deliveries,
  deliveryEvents,
  deliveryOffers,
  payments,
  riders,
  users,
} from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, isUniqueViolation, parseInput } from '../../shared/errors.ts';
import type { Authenticator } from '../auth/http.ts';
import type { DeliveryService } from '../deliveries/service.ts';
import type { Dispatcher } from '../dispatch/dispatcher.ts';
import type { Realtime } from '../realtime/hub.ts';
import { audit, auditFor } from './audit.ts';

const customers = alias(users, 'customers');
const riderUsers = alias(users, 'rider_users');

const listQuery = z.object({
  status: z.enum(DELIVERY_STATUSES).optional(),
  q: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const notFound = () => new AppError(404, 'NOT_FOUND', 'Delivery not found.');
/** Typed numbers often start with the local 0 or the 251 country code; stored ones are +2519…. */
const phoneNeedle = (digits: string) => digits.replace(/^(251|0)/, '').slice(-9);
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

export async function adminDeliveryRoutes(
  app: FastifyInstance,
  deps: {
    db: Db;
    clock: Clock;
    auth: Authenticator;
    deliveries: DeliveryService;
    dispatcher: Dispatcher;
    realtime: Realtime;
  },
) {
  const { db, clock, auth, deliveries: deliveryService, dispatcher, realtime } = deps;

  app.get('/admin/deliveries', async (req, reply) => {
    await auth.require(req, reply, 'admin');
    const { status, q, limit } = parseInput(listQuery, req.query);
    const digits = q?.replace(/\D/g, '');
    const search = q
      ? or(
          ilike(deliveries.publicCode, `%${q.toUpperCase()}%`),
          ilike(customers.fullName, `%${q}%`),
          digits && digits.length >= 4
            ? ilike(customers.phoneE164, `%${phoneNeedle(digits)}%`)
            : undefined,
          digits && digits.length >= 4
            ? ilike(deliveries.dropoffContactPhone, `%${phoneNeedle(digits)}%`)
            : undefined,
        )
      : undefined;
    const rows = await db
      .select({
        d: deliveries,
        customerName: customers.fullName,
        customerPhone: customers.phoneE164,
        riderName: riderUsers.fullName,
        fareStatus: payments.status,
      })
      .from(deliveries)
      .innerJoin(customers, eq(customers.id, deliveries.customerId))
      .leftJoin(riderUsers, eq(riderUsers.id, deliveries.riderId))
      .leftJoin(payments, and(eq(payments.deliveryId, deliveries.id), eq(payments.kind, 'fare')))
      .where(and(status ? eq(deliveries.status, status) : undefined, search))
      .orderBy(desc(deliveries.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.d.id,
      code: r.d.publicCode,
      status: r.d.status,
      vehicleType: r.d.vehicleType,
      pickup: r.d.pickupAddress,
      dropoff: r.d.dropoffAddress,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      riderName: r.riderName,
      fare: r.d.fareAmount,
      fareStatus: r.fareStatus,
      createdAt: r.d.createdAt.toISOString(),
    }));
  });

  app.get<{ Params: { id: string } }>('/admin/deliveries/:id', async (req, reply) => {
    await auth.require(req, reply, 'admin');
    const id = req.params.id;
    if (!isUuid(id)) throw notFound();
    const [row] = await db
      .select({ d: deliveries, customer: { phone: customers.phoneE164, name: customers.fullName } })
      .from(deliveries)
      .innerJoin(customers, eq(customers.id, deliveries.customerId))
      .where(eq(deliveries.id, id));
    if (!row) throw notFound();
    const d = row.d;
    const [events, offers, pays, attempts, rider, log] = await Promise.all([
      db
        .select()
        .from(deliveryEvents)
        .where(eq(deliveryEvents.deliveryId, id))
        .orderBy(asc(deliveryEvents.createdAt)),
      db
        .select({ o: deliveryOffers, name: riderUsers.fullName })
        .from(deliveryOffers)
        .innerJoin(riderUsers, eq(riderUsers.id, deliveryOffers.riderId))
        .where(eq(deliveryOffers.deliveryId, id))
        .orderBy(asc(deliveryOffers.offeredAt)),
      db.select().from(payments).where(eq(payments.deliveryId, id)),
      db
        .select()
        .from(contactAttempts)
        .where(eq(contactAttempts.deliveryId, id))
        .orderBy(asc(contactAttempts.attemptedAt)),
      d.riderId
        ? db
            .select({
              phone: riderUsers.phoneE164,
              name: riderUsers.fullName,
              plate: riders.plateNumber,
            })
            .from(riders)
            .innerJoin(riderUsers, eq(riderUsers.id, riders.userId))
            .where(eq(riders.userId, d.riderId))
        : Promise.resolve([]),
      auditFor(db, 'delivery', id),
    ]);
    return {
      id: d.id,
      code: d.publicCode,
      status: d.status,
      vehicleType: d.vehicleType,
      payer: d.payer,
      preferredPaymentMethod: d.preferredPaymentMethod,
      customer: row.customer,
      rider: rider[0] ? { id: d.riderId, ...rider[0] } : null,
      pickup: {
        address: d.pickupAddress,
        subCity: d.pickupSubCity,
        contactName: d.pickupContactName,
        contactPhone: d.pickupContactPhone,
        notes: d.pickupNotes,
        lat: d.pickupLat,
        lng: d.pickupLng,
      },
      dropoff: {
        address: d.dropoffAddress,
        subCity: d.dropoffSubCity,
        contactName: d.dropoffContactName,
        contactPhone: d.dropoffContactPhone,
        notes: d.dropoffNotes,
        lat: d.dropoffLat,
        lng: d.dropoffLng,
      },
      parcel: { description: d.parcelDescription, size: d.parcelSize },
      money: {
        fare: d.fareAmount,
        commissionRate: d.commissionRate,
        commission: d.commissionAmount,
        riderEarning: d.riderEarning,
        cancellationFee: d.cancellationFee,
      },
      distanceKm: d.distanceKm,
      dispatchRound: d.dispatchRound,
      cancelReason: d.cancelReason,
      cancelledBy: d.cancelledBy,
      createdAt: d.createdAt.toISOString(),
      events: events.map((e) => ({
        id: e.id,
        from: e.fromStatus,
        to: e.toStatus,
        actor: e.actorRole,
        note: e.note,
        at: e.createdAt.toISOString(),
      })),
      offers: offers.map(({ o, name }) => ({
        id: o.id,
        riderName: name,
        status: o.status,
        round: o.round,
        toPickupKm: o.toPickupKm,
        offeredAt: o.offeredAt.toISOString(),
        respondedAt: o.respondedAt?.toISOString() ?? null,
      })),
      payments: pays.map((p) => ({
        id: p.id,
        kind: p.kind,
        status: p.status,
        amount: p.amount,
        method: p.method,
        reference: p.reference,
        collectedAt: p.collectedAt?.toISOString() ?? null,
        note: p.note,
      })),
      contactAttempts: attempts.map((a) => ({
        outcome: a.outcome,
        at: a.attemptedAt.toISOString(),
      })),
      audit: log,
    };
  });

  /** Manually give a waiting delivery to a specific rider (approved, free). */
  app.post<{ Params: { id: string } }>('/admin/deliveries/:id/assign', async (req, reply) => {
    const { user: admin } = await auth.require(req, reply, 'admin');
    const { riderId } = parseInput(adminAssignSchema, req.body);
    if (!isUuid(req.params.id)) throw notFound();
    const [rider] = await db.select().from(riders).where(eq(riders.userId, riderId));
    if (!rider || rider.approvalStatus !== 'approved') {
      throw new AppError(409, 'RIDER_UNAVAILABLE', 'That rider is not approved.');
    }
    const now = clock.now();
    try {
      await db.transaction(async (tx) => {
        const [d] = await tx
          .update(deliveries)
          .set({
            riderId,
            status: 'assigned',
            assignedAt: now,
            updatedAt: now,
            version: sql`${deliveries.version} + 1`,
          })
          .where(
            and(
              eq(deliveries.id, req.params.id),
              eq(deliveries.status, 'requested'),
              eq(deliveries.vehicleType, rider.vehicleType),
            ),
          )
          .returning({ id: deliveries.id });
        if (!d) {
          throw new AppError(
            409,
            'CANNOT_ASSIGN',
            'Only a delivery still waiting for a rider, with a matching vehicle, can be assigned.',
          );
        }
        await tx
          .update(deliveryOffers)
          .set({ status: 'withdrawn', respondedAt: now })
          .where(
            or(
              and(eq(deliveryOffers.deliveryId, d.id), eq(deliveryOffers.status, 'offered')),
              and(eq(deliveryOffers.riderId, riderId), eq(deliveryOffers.status, 'offered')),
            ),
          );
        await tx.insert(deliveryEvents).values({
          deliveryId: d.id,
          fromStatus: 'requested',
          toStatus: 'assigned',
          actorRole: 'admin',
          actorUserId: admin.id,
          note: 'Assigned manually',
          metadata: { riderId },
          createdAt: now,
        });
        await audit(tx, admin.id, 'delivery.assign', { type: 'delivery', id: d.id }, { riderId });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'RIDER_BUSY', 'That rider already has an active delivery.');
      }
      throw err;
    }
    await realtime.deliveryChanged(req.params.id);
    realtime.notifyUser(riderId, 'offer');
    return reply.status(204).send();
  });

  /** Start a new dispatch round: riders who passed earlier may be asked again. */
  app.post<{ Params: { id: string } }>('/admin/deliveries/:id/redispatch', async (req, reply) => {
    const { user: admin } = await auth.require(req, reply, 'admin');
    if (!isUuid(req.params.id)) throw notFound();
    const now = clock.now();
    await db.transaction(async (tx) => {
      const [d] = await tx
        .update(deliveries)
        .set({ dispatchRound: sql`${deliveries.dispatchRound} + 1`, updatedAt: now })
        .where(and(eq(deliveries.id, req.params.id), eq(deliveries.status, 'requested')))
        .returning({ id: deliveries.id, round: deliveries.dispatchRound });
      if (!d)
        throw new AppError(
          409,
          'CANNOT_REDISPATCH',
          'Only a delivery waiting for a rider can be re-offered.',
        );
      await tx
        .update(deliveryOffers)
        .set({ status: 'withdrawn', respondedAt: now })
        .where(and(eq(deliveryOffers.deliveryId, d.id), eq(deliveryOffers.status, 'offered')));
      await audit(
        tx,
        admin.id,
        'delivery.redispatch',
        { type: 'delivery', id: d.id },
        { round: d.round },
      );
    });
    const result = await dispatcher.dispatch(req.params.id);
    return { result };
  });

  app.post<{ Params: { id: string } }>('/admin/deliveries/:id/cancel', async (req, reply) => {
    const { user: admin } = await auth.require(req, reply, 'admin');
    const { reason, chargeFee } = parseInput(adminCancelSchema, req.body);
    if (!isUuid(req.params.id)) throw notFound();
    await deliveryService.cancelByAdmin(admin.id, req.params.id, reason, chargeFee);
    await audit(
      db,
      admin.id,
      'delivery.cancel',
      { type: 'delivery', id: req.params.id },
      { reason, chargeFee },
    );
    return reply.status(204).send();
  });

  /** Approved riders who could take a job right now (for the manual-assign picker). */
  app.get('/admin/riders/available', async (req, reply) => {
    await auth.require(req, reply, 'admin');
    const busy = db
      .select({ id: deliveries.riderId })
      .from(deliveries)
      .where(inArray(deliveries.status, [...ACTIVE_RIDER_STATUSES]));
    const rows = await db
      .select({
        id: riders.userId,
        name: users.fullName,
        phone: users.phoneE164,
        vehicleType: riders.vehicleType,
        plate: riders.plateNumber,
        isOnline: riders.isOnline,
      })
      .from(riders)
      .innerJoin(users, eq(users.id, riders.userId))
      .where(and(eq(riders.approvalStatus, 'approved'), sql`${riders.userId} not in (${busy})`))
      .orderBy(desc(riders.isOnline), asc(users.fullName));
    return rows;
  });
}
