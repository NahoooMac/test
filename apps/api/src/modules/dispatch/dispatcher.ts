// Offers each waiting delivery to the nearest free rider, one rider at a time.
//
// Correctness under concurrency comes from the database, not from this process:
//  - delivery_offers_one_open_per_delivery: a delivery has at most one open offer
//  - delivery_offers_one_open_per_rider:    a rider holds at most one open offer
//  - deliveries_one_active_per_rider:       a rider has at most one active delivery
// So several API instances (or overlapping ticks) can run this safely.
import { and, asc, eq, inArray, isNull, lt, ne, notExists, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { ACTIVE_RIDER_STATUSES, pickupArea } from '@dp/shared';
import type { Db } from '../../db/client.ts';
import {
  deliveries,
  deliveryOffers,
  riderLedger,
  riderServiceAreas,
  riders,
} from '../../db/schema.ts';
import { getSettings } from '../platform/settings.ts';
import { loadSignals, scoreRider } from './matching.ts';
import { addSeconds, type Clock } from '../../shared/clock.ts';
import { isUniqueViolation, violatedConstraint } from '../../shared/errors.ts';
import { noopRealtime, type Realtime } from '../realtime/hub.ts';

export interface DispatchOptions {
  /** Seconds a rider has to accept. */
  offerTtlSec: number;
  /** Riders farther than this from the pickup are not offered the job. */
  maxRadiusKm: number;
  /** A rider's last GPS fix must be at most this old. */
  locationFreshSec: number;
}

export const DEFAULT_DISPATCH: DispatchOptions = {
  offerTtlSec: 20,
  maxRadiusKm: 7,
  locationFreshSec: 120,
};

export type DispatchResult = 'offered' | 'already_offered' | 'no_rider' | 'not_requested';

export class Dispatcher {
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly log: FastifyBaseLogger;
  private readonly opts: DispatchOptions;
  private readonly realtime: Realtime;
  private ticking = false;

  constructor(
    db: Db,
    clock: Clock,
    log: FastifyBaseLogger,
    opts: Partial<DispatchOptions> = {},
    realtime: Realtime = noopRealtime,
  ) {
    this.realtime = realtime;
    this.db = db;
    this.clock = clock;
    this.log = log;
    this.opts = { ...DEFAULT_DISPATCH, ...opts };
  }

  /** Try to offer one delivery to the nearest eligible rider. */
  async dispatch(deliveryId: string): Promise<DispatchResult> {
    const now = this.clock.now();
    const [d] = await this.db
      .select({
        status: deliveries.status,
        vehicleType: deliveries.vehicleType,
        lat: deliveries.pickupLat,
        lng: deliveries.pickupLng,
        round: deliveries.dispatchRound,
        customerId: deliveries.customerId,
        subCity: deliveries.pickupSubCity,
        commission: deliveries.commissionAmount,
      })
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId));
    if (!d || d.status !== 'requested') return 'not_requested';

    const settings = await getSettings(this.db);
    const area = pickupArea(d.subCity, { lat: d.lat, lng: d.lng });
    // The rider's ledger sum (+ owed); the wallet balance is its negative.
    const balance = sql`(select coalesce(sum(l.amount), 0) from ${riderLedger} l where l.rider_id = "riders"."user_id")`;

    // Equirectangular distance in km: accurate to well under 1% across a city.
    const km = sql<number>`111.32 * sqrt(power(${riders.currentLat} - ${d.lat}, 2) + power(cos(radians(${d.lat})) * (${riders.currentLng} - ${d.lng}), 2))`;
    const candidates = await this.db
      .select({ riderId: riders.userId, km: km.mapWith(Number) })
      .from(riders)
      .where(
        and(
          eq(riders.approvalStatus, 'approved'),
          eq(riders.isOnline, true),
          eq(riders.vehicleType, d.vehicleType),
          // A rider who also sends parcels is never offered their own delivery.
          ne(riders.userId, d.customerId),
          // Service area: the pickup's area, unless the rider hasn't chosen any areas yet.
          sql`(not exists (select 1 from ${riderServiceAreas} a where a.rider_id = "riders"."user_id")
               or exists (select 1 from ${riderServiceAreas} a where a.rider_id = "riders"."user_id" and a.sub_city = ${area}))`,
          // Wallet: at least the minimum, and room for this job's commission above the debt limit.
          sql`(-${balance}) >= ${settings.walletMinBalance}::numeric
              and (-${balance}) - ${d.commission}::numeric >= -${settings.walletDebtLimit}::numeric`,
          sql`${riders.locationUpdatedAt} > ${addSeconds(now, -this.opts.locationFreshSec).toISOString()}::timestamptz`,
          sql`${km} <= ${this.opts.maxRadiusKm}`,
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(deliveries)
              .where(
                and(
                  eq(deliveries.riderId, riders.userId),
                  inArray(deliveries.status, [...ACTIVE_RIDER_STATUSES]),
                ),
              ),
          ),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(deliveryOffers)
              .where(
                and(
                  eq(deliveryOffers.riderId, riders.userId),
                  // Busy with another offer, or already asked for this delivery in this round.
                  sql`(${deliveryOffers.status} = 'offered' or (${deliveryOffers.deliveryId} = ${deliveryId} and ${deliveryOffers.round} = ${d.round}))`,
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(km))
      .limit(20);

    // Rank the eligible riders: distance, home, rating, points, fairness, reliability.
    const signals = await loadSignals(
      this.db,
      candidates.map((c) => c.riderId),
      now,
    );
    const ranked = candidates
      .map((c) => ({
        ...c,
        score: scoreRider(
          signals.get(c.riderId)!,
          c.km,
          { lat: d.lat, lng: d.lng },
          settings.matching,
          now,
        ),
      }))
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, 5);

    for (const c of ranked) {
      try {
        await this.db.insert(deliveryOffers).values({
          deliveryId,
          riderId: c.riderId,
          toPickupKm: Math.round(c.km * 100) / 100,
          round: d.round,
          offeredAt: now,
          expiresAt: addSeconds(now, this.opts.offerTtlSec),
          score: { total: c.score.total, ...c.score.parts },
        });
        this.log.info(
          { deliveryId, riderId: c.riderId, km: c.km.toFixed(2), score: c.score.total },
          'offer sent',
        );
        this.realtime.notifyUser(c.riderId, 'offer', { deliveryId });
        this.realtime.publish({ type: 'ops', data: { deliveryId } }, { admins: true });
        return 'offered';
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const constraint = violatedConstraint(err);
        // Another process already offered this delivery: nothing to do.
        if (constraint === 'delivery_offers_one_open_per_delivery') return 'already_offered';
        // The rider just received another offer (or the constraint name is unknown): try the next.
        if (constraint === undefined && (await this.hasOpenOffer(deliveryId)))
          return 'already_offered';
      }
    }
    return 'no_rider';
  }

  /**
   * Housekeeping, run every few seconds: lapse expired offers, then (re)dispatch every waiting
   * delivery that has no open offer. Overlapping calls are skipped.
   */
  async tick(): Promise<{ expired: number; offered: number }> {
    if (this.ticking) return { expired: 0, offered: 0 };
    this.ticking = true;
    try {
      const now = this.clock.now();
      const expired = await this.db
        .update(deliveryOffers)
        .set({ status: 'expired', respondedAt: now })
        .where(and(eq(deliveryOffers.status, 'offered'), lt(deliveryOffers.expiresAt, now)))
        .returning({ id: deliveryOffers.id, riderId: deliveryOffers.riderId });
      for (const e of expired) this.realtime.notifyUser(e.riderId, 'offer', { expired: true });

      const waiting = await this.db
        .select({ id: deliveries.id })
        .from(deliveries)
        .leftJoin(
          deliveryOffers,
          and(eq(deliveryOffers.deliveryId, deliveries.id), eq(deliveryOffers.status, 'offered')),
        )
        .where(and(eq(deliveries.status, 'requested'), isNull(deliveryOffers.id)))
        .orderBy(asc(deliveries.createdAt))
        .limit(50);

      let offered = 0;
      for (const w of waiting) {
        if ((await this.dispatch(w.id)) === 'offered') offered++;
      }
      return { expired: expired.length, offered };
    } finally {
      this.ticking = false;
    }
  }

  private async hasOpenOffer(deliveryId: string) {
    const [row] = await this.db
      .select({ id: deliveryOffers.id })
      .from(deliveryOffers)
      .where(and(eq(deliveryOffers.deliveryId, deliveryId), eq(deliveryOffers.status, 'offered')))
      .limit(1);
    return !!row;
  }
}
