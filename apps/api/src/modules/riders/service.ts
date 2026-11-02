import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { riderApplySchema } from '@dp/shared';
import {
  ACTIVE_RIDER_STATUSES,
  FAIL_MIN_ATTEMPTS,
  FAIL_MIN_MINUTES,
  type ContactOutcome,
  type DeliveryStatus,
  type RiderHome,
  type RiderJob,
  type RiderOffer,
  type RiderProfile,
} from '@dp/shared';
import type { z } from 'zod';
import type { Db, Tx } from '../../db/client.ts';
import {
  contactAttempts,
  deliveries,
  deliveryEvents,
  deliveryOffers,
  riders,
  users,
} from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, isUniqueViolation, violatedConstraint } from '../../shared/errors.ts';
import { canTransition, STATUS_TIMESTAMP } from '../deliveries/state-machine.ts';
import { noopRealtime, type Realtime } from '../realtime/hub.ts';
import { PaymentService } from '../payments/service.ts';
import { currentRules } from '../pricing/repo.ts';

type DeliveryRow = typeof deliveries.$inferSelect;

const notFound = () => new AppError(404, 'NOT_FOUND', 'Job not found.');
const notApproved = () =>
  new AppError(403, 'RIDER_NOT_APPROVED', 'Your rider account has not been approved yet.');

export class RiderService {
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly realtime: Realtime;

  private readonly payments: PaymentService;

  constructor(db: Db, clock: Clock, realtime: Realtime = noopRealtime, payments?: PaymentService) {
    this.db = db;
    this.clock = clock;
    this.realtime = realtime;
    this.payments = payments ?? new PaymentService(db, clock);
  }

  // ── Application ────────────────────────────────────────────────────────────

  /**
   * A customer can apply to ride with the same phone number and keep sending parcels: a rider
   * account still signs in to the customer app, and dispatch never offers riders their own bookings.
   */
  async apply(userId: string, input: z.output<typeof riderApplySchema>): Promise<RiderProfile> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw notFound();
    if (user.role === 'admin') {
      throw new AppError(409, 'ROLE_CONFLICT', 'Staff accounts cannot register as riders.');
    }
    // Only vehicles the service prices (and the database knows) can be registered.
    if (!(await currentRules(this.db)).has(input.vehicleType)) {
      throw new AppError(409, 'VEHICLE_NOT_OFFERED', 'We are not taking this vehicle type yet.', {
        fields: { vehicleType: 'We are not taking this vehicle type yet.' },
      });
    }
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ role: 'rider', fullName: input.fullName, updatedAt: now })
        .where(eq(users.id, userId));
      try {
        await tx.insert(riders).values({
          userId,
          vehicleType: input.vehicleType,
          plateNumber:
            input.vehicleType === 'motorcycle'
              ? (input.plateNumber ?? null)
              : input.plateNumber || null,
          createdAt: now,
          updatedAt: now,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError(409, 'ALREADY_APPLIED', 'You have already applied.');
        }
        throw err;
      }
    });
    this.realtime.publish({ type: 'ops', data: { riderId: userId } }, { admins: true });
    return (await this.profile(userId))!;
  }

  async profile(userId: string): Promise<RiderProfile | null> {
    const [row] = await this.db
      .select({ r: riders, u: { phone: users.phoneE164, name: users.fullName } })
      .from(riders)
      .innerJoin(users, eq(users.id, riders.userId))
      .where(eq(riders.userId, userId));
    if (!row) return null;
    return {
      userId,
      fullName: row.u.name,
      phone: row.u.phone,
      vehicleType: row.r.vehicleType,
      plateNumber: row.r.plateNumber,
      approvalStatus: row.r.approvalStatus,
      rejectionReason: row.r.rejectionReason,
      kycStatus: row.r.kycStatus,
      isOnline: row.r.isOnline,
      locationUpdatedAt: row.r.locationUpdatedAt?.toISOString() ?? null,
      createdAt: row.r.createdAt.toISOString(),
    };
  }

  // ── Live status ────────────────────────────────────────────────────────────

  async setOnline(userId: string, online: boolean): Promise<RiderProfile> {
    const p = await this.profile(userId);
    if (!p) throw notFound();
    if (online && p.approvalStatus !== 'approved') throw notApproved();
    await this.db
      .update(riders)
      .set({ isOnline: online, updatedAt: this.clock.now() })
      .where(eq(riders.userId, userId));
    if (!online) {
      // Going offline withdraws any offer the rider has not answered.
      await this.db
        .update(deliveryOffers)
        .set({ status: 'declined', respondedAt: this.clock.now() })
        .where(and(eq(deliveryOffers.riderId, userId), eq(deliveryOffers.status, 'offered')));
    }
    this.realtime.publish({ type: 'ops', data: { riderId: userId } }, { admins: true });
    return (await this.profile(userId))!;
  }

  async updateLocation(userId: string, lat: number, lng: number): Promise<void> {
    const now = this.clock.now();
    const updated = await this.db
      .update(riders)
      .set({ currentLat: lat, currentLng: lng, locationUpdatedAt: now })
      .where(and(eq(riders.userId, userId), eq(riders.approvalStatus, 'approved')))
      .returning({ id: riders.userId });
    if (updated.length === 0) throw notApproved();

    // Customer, public tracking page and admins follow the rider while a job is in progress.
    const [job] = await this.db
      .select({ id: deliveries.id, customerId: deliveries.customerId, code: deliveries.publicCode })
      .from(deliveries)
      .where(
        and(eq(deliveries.riderId, userId), inArray(deliveries.status, [...ACTIVE_RIDER_STATUSES])),
      )
      .limit(1);
    const point = { lat, lng, at: now.toISOString() };
    if (job) {
      this.realtime.publish(
        { type: 'location', data: { deliveryId: job.id, riderId: userId, ...point } },
        { userIds: [job.customerId], admins: true, publicCode: job.code },
      );
    } else {
      this.realtime.publish({ type: 'ops', data: { riderId: userId, ...point } }, { admins: true });
    }
  }

  // ── Home: offer + active job ───────────────────────────────────────────────

  async home(userId: string): Promise<RiderHome> {
    const profile = await this.profile(userId);
    if (!profile) return { profile: null, offer: null, job: null };
    return { profile, offer: await this.currentOffer(userId), job: await this.activeJob(userId) };
  }

  private async currentOffer(userId: string): Promise<RiderOffer | null> {
    const now = this.clock.now();
    const [row] = await this.db
      .select({ o: deliveryOffers, d: deliveries })
      .from(deliveryOffers)
      .innerJoin(deliveries, eq(deliveries.id, deliveryOffers.deliveryId))
      .where(and(eq(deliveryOffers.riderId, userId), eq(deliveryOffers.status, 'offered')))
      .limit(1);
    if (!row || row.o.expiresAt <= now) return null;
    const d = row.d;
    return {
      id: row.o.id,
      expiresAt: row.o.expiresAt.toISOString(),
      secondsLeft: Math.max(0, Math.floor((row.o.expiresAt.getTime() - now.getTime()) / 1000)),
      toPickupKm: row.o.toPickupKm,
      delivery: {
        code: d.publicCode,
        vehicleType: d.vehicleType,
        distanceKm: d.distanceKm,
        fare: d.fareAmount,
        riderEarning: d.riderEarning,
        payer: d.payer,
        parcel: { description: d.parcelDescription, size: d.parcelSize },
        pickup: {
          address: d.pickupAddress,
          subCity: d.pickupSubCity,
          lat: d.pickupLat,
          lng: d.pickupLng,
        },
        dropoff: {
          address: d.dropoffAddress,
          subCity: d.dropoffSubCity,
          lat: d.dropoffLat,
          lng: d.dropoffLng,
        },
      },
    };
  }

  private async activeJob(userId: string): Promise<RiderJob | null> {
    const [d] = await this.db
      .select()
      .from(deliveries)
      .where(
        and(eq(deliveries.riderId, userId), inArray(deliveries.status, [...ACTIVE_RIDER_STATUSES])),
      )
      .limit(1);
    return d ? this.toJob(d) : null;
  }

  private async toJob(d: DeliveryRow): Promise<RiderJob> {
    const attempts = await this.db
      .select()
      .from(contactAttempts)
      .where(eq(contactAttempts.deliveryId, d.id))
      .orderBy(asc(contactAttempts.attemptedAt));
    return {
      id: d.id,
      code: d.publicCode,
      status: d.status,
      vehicleType: d.vehicleType,
      distanceKm: d.distanceKm,
      fare: d.fareAmount,
      riderEarning: d.riderEarning,
      payer: d.payer,
      preferredPaymentMethod: d.preferredPaymentMethod,
      parcel: { description: d.parcelDescription, size: d.parcelSize },
      pickup: {
        address: d.pickupAddress,
        subCity: d.pickupSubCity,
        lat: d.pickupLat,
        lng: d.pickupLng,
        contactName: d.pickupContactName,
        contactPhone: d.pickupContactPhone,
        notes: d.pickupNotes,
      },
      dropoff: {
        address: d.dropoffAddress,
        subCity: d.dropoffSubCity,
        lat: d.dropoffLat,
        lng: d.dropoffLng,
        contactName: d.dropoffContactName,
        contactPhone: d.dropoffContactPhone,
        notes: d.dropoffNotes,
      },
      contactAttempts: attempts.map((a) => ({
        at: a.attemptedAt.toISOString(),
        outcome: a.outcome,
      })),
      farePayment: await this.farePaymentView(d.id),
      canFailAt:
        failAvailableAt(
          attempts.filter((a) => a.outcome !== 'answered').map((a) => a.attemptedAt),
        )?.toISOString() ?? null,
      assignedAt: d.assignedAt?.toISOString() ?? null,
    };
  }

  // ── Offers ─────────────────────────────────────────────────────────────────

  /**
   * Accepting is one transaction: claim the offer (still open, not expired), then assign the
   * delivery (still `requested`). The partial unique index on deliveries guarantees the rider
   * cannot end up with two active jobs even if two accepts race.
   */
  async accept(userId: string, offerId: string): Promise<RiderJob> {
    const now = this.clock.now();
    try {
      const deliveryId = await this.db.transaction(async (tx) => {
        const [offer] = await tx
          .update(deliveryOffers)
          .set({ status: 'accepted', respondedAt: now })
          .where(
            and(
              eq(deliveryOffers.id, offerId),
              eq(deliveryOffers.riderId, userId),
              eq(deliveryOffers.status, 'offered'),
            ),
          )
          .returning();
        if (!offer || offer.expiresAt <= now) {
          throw new AppError(409, 'OFFER_GONE', 'This job is no longer available.');
        }
        const [assigned] = await tx
          .update(deliveries)
          .set({
            riderId: userId,
            status: 'assigned',
            assignedAt: now,
            updatedAt: now,
            version: sql`${deliveries.version} + 1`,
          })
          .where(and(eq(deliveries.id, offer.deliveryId), eq(deliveries.status, 'requested')))
          .returning({ id: deliveries.id });
        if (!assigned) throw new AppError(409, 'OFFER_GONE', 'This job is no longer available.');
        await recordEvent(tx, offer.deliveryId, 'requested', 'assigned', 'system', userId, now, {
          offerId,
        });
        return offer.deliveryId;
      });
      await this.realtime.deliveryChanged(deliveryId);
      const [d] = await this.db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
      return this.toJob(d!);
    } catch (err) {
      if (
        isUniqueViolation(err) &&
        violatedConstraint(err) !== 'delivery_offers_once_per_rider_round'
      ) {
        throw new AppError(409, 'RIDER_BUSY', 'Finish your current job before accepting another.');
      }
      throw err;
    }
  }

  async decline(userId: string, offerId: string): Promise<void> {
    await this.db
      .update(deliveryOffers)
      .set({ status: 'declined', respondedAt: this.clock.now() })
      .where(
        and(
          eq(deliveryOffers.id, offerId),
          eq(deliveryOffers.riderId, userId),
          eq(deliveryOffers.status, 'offered'),
        ),
      );
  }

  // ── Job steps ──────────────────────────────────────────────────────────────

  async advance(
    userId: string,
    deliveryId: string,
    to: DeliveryStatus,
    at?: { lat?: number | undefined; lng?: number | undefined },
  ): Promise<RiderJob> {
    const d = await this.ownJob(userId, deliveryId);
    if (!canTransition(d.status, to, 'rider')) {
      throw new AppError(409, 'INVALID_STEP', `Cannot go from ${d.status} to ${to}.`);
    }
    if (to === 'requested') return this.release(userId, deliveryId);
    if (to === 'delivered') {
      const paid = await this.payments.farePayment(d.id);
      if (paid?.status !== 'collected') {
        throw new AppError(
          409,
          'PAYMENT_REQUIRED',
          'Record how the fare was paid before marking it delivered.',
        );
      }
    }
    await this.transition(d, to, 'rider', userId, at);
    return this.toJob((await this.ownJob(userId, deliveryId, true))!);
  }

  /** Rider gives the job back before reaching pickup; it is re-offered to someone else. */
  async release(userId: string, deliveryId: string): Promise<RiderJob> {
    const d = await this.ownJob(userId, deliveryId);
    if (!canTransition(d.status, 'requested', 'rider')) {
      throw new AppError(409, 'INVALID_STEP', 'This job can no longer be released.');
    }
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(deliveries)
        .set({
          status: 'requested',
          riderId: null,
          assignedAt: null,
          updatedAt: now,
          version: d.version + 1,
        })
        .where(and(eq(deliveries.id, d.id), eq(deliveries.version, d.version)))
        .returning({ id: deliveries.id });
      if (!updated.length) throw stale();
      await recordEvent(tx, d.id, d.status, 'requested', 'rider', userId, now, { released: true });
    });
    await this.realtime.deliveryChanged(d.id);
    this.realtime.notifyUser(userId, 'delivery', { id: d.id });
    const [after] = await this.db.select().from(deliveries).where(eq(deliveries.id, d.id));
    return this.toJob(after!);
  }

  async logContactAttempt(
    userId: string,
    deliveryId: string,
    outcome: ContactOutcome,
  ): Promise<RiderJob> {
    const d = await this.ownJob(userId, deliveryId);
    if (d.status !== 'arrived_dropoff') {
      throw new AppError(409, 'INVALID_STEP', 'Call attempts are logged at the drop-off.');
    }
    await this.db
      .insert(contactAttempts)
      .values({ deliveryId, riderId: userId, outcome, attemptedAt: this.clock.now() });
    return this.toJob(d);
  }

  /**
   * Failed delivery (business rule): the receiver stayed unreachable after at least three calls
   * over at least ten minutes. The delivery moves to `failed` and straight on to `returning`;
   * the fare stays due and no return fee is added.
   */
  async fail(userId: string, deliveryId: string): Promise<RiderJob> {
    const d = await this.ownJob(userId, deliveryId);
    if (!canTransition(d.status, 'failed', 'rider')) {
      throw new AppError(409, 'INVALID_STEP', 'A delivery can only fail at the drop-off.');
    }
    const attempts = await this.db
      .select({ at: contactAttempts.attemptedAt, outcome: contactAttempts.outcome })
      .from(contactAttempts)
      .where(eq(contactAttempts.deliveryId, deliveryId))
      .orderBy(asc(contactAttempts.attemptedAt));
    const unanswered = attempts.filter((a) => a.outcome !== 'answered').map((a) => a.at);
    const availableAt = failAvailableAt(unanswered);
    const now = this.clock.now();
    if (!availableAt || availableAt > now) {
      throw new AppError(
        409,
        'FAIL_RULE_NOT_MET',
        `Call the receiver at least ${FAIL_MIN_ATTEMPTS} times over ${FAIL_MIN_MINUTES} minutes first.`,
        {
          details: { availableAt: availableAt?.toISOString() ?? null, attempts: unanswered.length },
        },
      );
    }
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(deliveries)
        .set({ status: 'returning', failedAt: now, updatedAt: now, version: d.version + 1 })
        .where(
          and(
            eq(deliveries.id, d.id),
            eq(deliveries.version, d.version),
            eq(deliveries.status, d.status),
          ),
        )
        .returning({ id: deliveries.id });
      if (!updated.length) throw stale();
      await recordEvent(tx, d.id, d.status, 'failed', 'rider', userId, now, {
        attempts: unanswered.length,
      });
      await recordEvent(tx, d.id, 'failed', 'returning', 'system', null, now);
    });
    await this.realtime.deliveryChanged(d.id);
    return this.toJob((await this.ownJob(userId, deliveryId, true))!);
  }

  /** Rider records how the fare was paid (also allowed after a return, since the fare stays due). */
  async recordFarePayment(
    userId: string,
    deliveryId: string,
    method: 'cash' | 'telebirr' | 'cbe_birr',
    reference: string | undefined,
  ): Promise<RiderJob> {
    const d = await this.ownJob(userId, deliveryId, true);
    await this.payments.recordFare(d, userId, method, reference);
    await this.realtime.deliveryChanged(d.id);
    return this.toJob(d);
  }

  async ledger(userId: string) {
    const [balance, entries] = await Promise.all([
      this.payments.balance(userId),
      this.payments.entries(userId, 30),
    ]);
    return {
      balance,
      entries: entries.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    };
  }

  private async farePaymentView(deliveryId: string) {
    const p = await this.payments.farePayment(deliveryId);
    return p?.status === 'collected' && p.method && p.collectedAt
      ? { method: p.method, reference: p.reference, at: p.collectedAt.toISOString() }
      : null;
  }

  async recentJobs(userId: string) {
    return this.db
      .select({
        id: deliveries.id,
        code: deliveries.publicCode,
        status: deliveries.status,
        riderEarning: deliveries.riderEarning,
        fare: deliveries.fareAmount,
        cancellationFee: deliveries.cancellationFee,
        updatedAt: deliveries.updatedAt,
      })
      .from(deliveries)
      .where(eq(deliveries.riderId, userId))
      .orderBy(desc(deliveries.updatedAt))
      .limit(30);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async ownJob(
    userId: string,
    deliveryId: string,
    includeDone = false,
  ): Promise<DeliveryRow> {
    if (!/^[0-9a-f-]{36}$/i.test(deliveryId)) throw notFound();
    const [d] = await this.db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.id, deliveryId), eq(deliveries.riderId, userId)));
    if (!d) throw notFound();
    if (!includeDone && !(ACTIVE_RIDER_STATUSES as readonly string[]).includes(d.status)) {
      throw new AppError(409, 'JOB_CLOSED', 'This job is already finished.');
    }
    return d;
  }

  private async transition(
    d: DeliveryRow,
    to: DeliveryStatus,
    actor: 'rider' | 'admin' | 'system',
    actorUserId: string | null,
    at?: { lat?: number | undefined; lng?: number | undefined },
  ) {
    const now = this.clock.now();
    const stamp = (STATUS_TIMESTAMP as Partial<Record<DeliveryStatus, string>>)[to];
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(deliveries)
        .set({
          status: to,
          updatedAt: now,
          version: d.version + 1,
          ...(stamp ? { [stamp]: now } : {}),
        })
        .where(
          and(
            eq(deliveries.id, d.id),
            eq(deliveries.version, d.version),
            eq(deliveries.status, d.status),
          ),
        )
        .returning({ id: deliveries.id });
      if (!updated.length) throw stale();
      await recordEvent(tx, d.id, d.status, to, actor, actorUserId, now, undefined, at);
    });
    await this.realtime.deliveryChanged(d.id);
  }
}

const stale = () => new AppError(409, 'STALE', 'This job just changed. Refresh and try again.');

/** When the failed-delivery rule is met, given the times of unanswered calls (sorted). */
export function failAvailableAt(times: Date[]): Date | null {
  if (times.length < FAIL_MIN_ATTEMPTS) return null;
  const first = times[0]!.getTime();
  const last = times[times.length - 1]!.getTime();
  return new Date(Math.max(last, first + FAIL_MIN_MINUTES * 60_000));
}

async function recordEvent(
  tx: Tx,
  deliveryId: string,
  from: DeliveryStatus | null,
  to: DeliveryStatus,
  actorRole: 'customer' | 'rider' | 'admin' | 'system',
  actorUserId: string | null,
  at: Date,
  metadata?: Record<string, unknown>,
  where?: { lat?: number | undefined; lng?: number | undefined },
) {
  await tx.insert(deliveryEvents).values({
    deliveryId,
    fromStatus: from,
    toStatus: to,
    actorRole,
    actorUserId,
    metadata: metadata ?? null,
    lat: where?.lat ?? null,
    lng: where?.lng ?? null,
    createdAt: at,
  });
}
