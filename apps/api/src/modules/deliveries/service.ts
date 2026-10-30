import { randomInt } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { createDeliverySchema } from '@dp/shared';
import {
  VEHICLE_TYPES,
  roundCoord,
  type ActorRole,
  type Delivery,
  type DeliveryEvent,
  type DeliverySummary,
  type Quote,
  type QuoteRequest,
} from '@dp/shared';
import type { z } from 'zod';
import { alias } from 'drizzle-orm/pg-core';
import type { Db, Tx } from '../../db/client.ts';
import { deliveries, deliveryEvents, pricingRules, riders, users } from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, isUniqueViolation } from '../../shared/errors.ts';
import { computeFare, estimateRoadKm, etaMinutes, unavailableReason } from '../pricing/pricing.ts';
import { currentRule, currentRules } from '../pricing/repo.ts';
import { canTransition, customerCancellationFee } from './state-machine.ts';

type DeliveryRow = typeof deliveries.$inferSelect;
type EventRow = typeof deliveryEvents.$inferSelect;
type CreateInput = z.output<typeof createDeliverySchema>;

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const newPublicCode = () =>
  Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

/** Explicit alias: the rider's user row, distinct from any other join on `users`. */
const riderUsers = alias(users, 'rider_users');

const notFound = () => new AppError(404, 'NOT_FOUND', 'Delivery not found.');

export class DeliveryService {
  private readonly db: Db;
  private readonly clock: Clock;

  constructor(db: Db, clock: Clock) {
    this.db = db;
    this.clock = clock;
  }

  async quote({ pickup, dropoff }: QuoteRequest): Promise<Quote> {
    const km = estimateRoadKm(pickup, dropoff);
    const rules = await currentRules(this.db);
    const options = VEHICLE_TYPES.flatMap((vehicleType) => {
      const rule = rules.get(vehicleType);
      if (!rule) return [];
      const reason = unavailableReason(rule, km);
      return [
        {
          vehicleType,
          available: reason === null,
          unavailableReason: reason,
          fare: computeFare(rule, km).fare,
          etaMin: etaMinutes(km, vehicleType),
          cancellationFeeAfterArrival: rule.cancellationFeeAfterArrival,
        },
      ];
    });
    return { distanceKm: km, distanceSource: 'estimate', options };
  }

  /**
   * Creates a booking. The fare is always recomputed here from the current rule — a client-sent
   * price is never trusted. The same idempotency key returns the original booking instead of a copy.
   */
  async create(
    customerId: string,
    input: CreateInput,
    idempotencyKey: string,
  ): Promise<{ delivery: Delivery; created: boolean }> {
    const existing = await this.findByIdempotencyKey(customerId, idempotencyKey);
    if (existing)
      return { delivery: await this.getForCustomer(customerId, existing.id), created: false };

    const pickup = { lat: roundCoord(input.pickup.lat), lng: roundCoord(input.pickup.lng) };
    const dropoff = { lat: roundCoord(input.dropoff.lat), lng: roundCoord(input.dropoff.lng) };
    const km = estimateRoadKm(pickup, dropoff);
    const rule = await currentRule(this.db, input.vehicleType);
    const reason = unavailableReason(rule, km);
    if (reason) {
      throw new AppError(422, 'VEHICLE_UNAVAILABLE', reason, { fields: { vehicleType: reason } });
    }
    const fare = computeFare(rule, km);
    const now = this.clock.now();

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const id = await this.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(deliveries)
            .values({
              publicCode: newPublicCode(),
              customerId,
              vehicleType: input.vehicleType,
              payer: input.payer,
              preferredPaymentMethod: input.preferredPaymentMethod,
              pickupAddress: input.pickup.address,
              pickupLat: pickup.lat,
              pickupLng: pickup.lng,
              pickupSubCity: input.pickup.subCity ?? null,
              pickupContactName: input.pickup.contactName,
              pickupContactPhone: input.pickup.contactPhone,
              pickupNotes: input.pickup.notes,
              dropoffAddress: input.dropoff.address,
              dropoffLat: dropoff.lat,
              dropoffLng: dropoff.lng,
              dropoffSubCity: input.dropoff.subCity ?? null,
              dropoffContactName: input.dropoff.contactName,
              dropoffContactPhone: input.dropoff.contactPhone,
              dropoffNotes: input.dropoff.notes,
              parcelDescription: input.parcel.description,
              parcelSize: input.parcel.size,
              distanceKm: km,
              distanceSource: 'estimate',
              etaMin: etaMinutes(km, input.vehicleType),
              pricingRuleId: rule.id,
              fareAmount: fare.fare,
              commissionRate: fare.commissionRate,
              commissionAmount: fare.commissionAmount,
              riderEarning: fare.riderEarning,
              idempotencyKey,
              createdAt: now,
              updatedAt: now,
            })
            .returning({ id: deliveries.id });
          await this.recordEvent(tx, row!.id, null, 'requested', 'customer', customerId, null);
          return row!.id;
        });
        return { delivery: await this.getForCustomer(customerId, id), created: true };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Same key raced in from a double tap: return the booking that won.
        const raced = await this.findByIdempotencyKey(customerId, idempotencyKey);
        if (raced)
          return { delivery: await this.getForCustomer(customerId, raced.id), created: false };
        // Otherwise the random public code collided; try another.
      }
    }
    throw new AppError(503, 'TRY_AGAIN', 'Please try again.');
  }

  async listForCustomer(customerId: string): Promise<DeliverySummary[]> {
    const rows = await this.selectWithJoins()
      .where(eq(deliveries.customerId, customerId))
      .orderBy(desc(deliveries.createdAt))
      .limit(50);
    return rows.map((r) => this.toSummary(r));
  }

  async getForCustomer(customerId: string, id: string): Promise<Delivery> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
    const [row] = await this.selectWithJoins()
      .where(and(eq(deliveries.id, id), eq(deliveries.customerId, customerId)))
      .limit(1);
    if (!row) throw notFound(); // also hides other customers' deliveries
    const events = await this.db
      .select()
      .from(deliveryEvents)
      .where(eq(deliveryEvents.deliveryId, id))
      .orderBy(asc(deliveryEvents.createdAt));
    return { ...this.toSummary(row), events: events.map(toEventDto) };
  }

  async cancelByCustomer(
    customerId: string,
    id: string,
    reason: string | undefined,
  ): Promise<Delivery> {
    const current = await this.getForCustomer(customerId, id);
    const fee = current.cancelFeeNow;
    if (fee === null || !canTransition(current.status, 'cancelled', 'customer')) {
      throw new AppError(409, 'CANNOT_CANCEL', 'This delivery can no longer be cancelled.');
    }
    const [row] = await this.db
      .select({ version: deliveries.version })
      .from(deliveries)
      .where(eq(deliveries.id, id));
    const now = this.clock.now();

    await this.db.transaction(async (tx) => {
      // Optimistic lock: if the rider moved the delivery on meanwhile, nothing is updated.
      const updated = await tx
        .update(deliveries)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: 'customer',
          cancellationFee: fee,
          cancelReason: reason ?? null,
          version: row!.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(deliveries.id, id),
            eq(deliveries.status, current.status),
            eq(deliveries.version, row!.version),
          ),
        )
        .returning({ id: deliveries.id });
      if (updated.length === 0) {
        throw new AppError(409, 'STALE', 'This delivery just changed. Refresh and try again.');
      }
      await this.recordEvent(
        tx,
        id,
        current.status,
        'cancelled',
        'customer',
        customerId,
        reason ?? null,
        {
          cancellationFee: fee,
        },
      );
    });
    return this.getForCustomer(customerId, id);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async findByIdempotencyKey(customerId: string, key: string) {
    const [row] = await this.db
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(and(eq(deliveries.customerId, customerId), eq(deliveries.idempotencyKey, key)))
      .limit(1);
    return row ?? null;
  }

  private async recordEvent(
    tx: Tx,
    deliveryId: string,
    from: DeliveryRow['status'] | null,
    to: DeliveryRow['status'],
    actorRole: ActorRole,
    actorUserId: string | null,
    note: string | null,
    metadata?: Record<string, unknown>,
  ) {
    await tx.insert(deliveryEvents).values({
      deliveryId,
      fromStatus: from,
      toStatus: to,
      actorRole,
      actorUserId,
      note,
      metadata: metadata ?? null,
      createdAt: this.clock.now(),
    });
  }

  private selectWithJoins() {
    return this.db
      .select({
        d: deliveries,
        feeAfterArrival: pricingRules.cancellationFeeAfterArrival,
        // Drizzle decides a left-joined object is null from its FIRST column, so lead with a NOT NULL one.
        rider: { vehicleType: riders.vehicleType, plate: riders.plateNumber },
        riderUser: { phone: riderUsers.phoneE164, name: riderUsers.fullName },
      })
      .from(deliveries)
      .innerJoin(pricingRules, eq(pricingRules.id, deliveries.pricingRuleId))
      .leftJoin(riders, eq(riders.userId, deliveries.riderId))
      .leftJoin(riderUsers, eq(riderUsers.id, deliveries.riderId));
  }

  private toSummary(
    r: Awaited<ReturnType<ReturnType<DeliveryService['selectWithJoins']>['execute']>>[number],
  ): DeliverySummary {
    const d = r.d;
    return {
      id: d.id,
      code: d.publicCode,
      status: d.status,
      vehicleType: d.vehicleType,
      payer: d.payer,
      preferredPaymentMethod: d.preferredPaymentMethod,
      pickup: {
        address: d.pickupAddress,
        lat: d.pickupLat,
        lng: d.pickupLng,
        subCity: d.pickupSubCity,
        contactName: d.pickupContactName,
        contactPhone: d.pickupContactPhone,
        notes: d.pickupNotes,
      },
      dropoff: {
        address: d.dropoffAddress,
        lat: d.dropoffLat,
        lng: d.dropoffLng,
        subCity: d.dropoffSubCity,
        contactName: d.dropoffContactName,
        contactPhone: d.dropoffContactPhone,
        notes: d.dropoffNotes,
      },
      parcel: { description: d.parcelDescription, size: d.parcelSize },
      distanceKm: d.distanceKm,
      etaMin: d.etaMin,
      fare: d.fareAmount,
      cancellationFee: d.cancellationFee,
      cancelFeeNow: customerCancellationFee(d.status, r.feeAfterArrival),
      rider:
        d.riderId && r.riderUser && r.rider
          ? {
              name: r.riderUser.name,
              phone: r.riderUser.phone,
              vehicleType: r.rider.vehicleType,
              plate: r.rider.plate,
            }
          : null,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    };
  }
}

function toEventDto(e: EventRow): DeliveryEvent {
  return {
    id: e.id,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    actorRole: e.actorRole,
    note: e.note,
    at: e.createdAt.toISOString(),
  };
}
