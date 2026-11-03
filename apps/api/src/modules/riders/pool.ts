// Delivery offer pool: deliveries a rider could claim right now.
//
// In the pool: status `requested` (never claimed, or released back by a rider — safe to reassign),
// the rider's vehicle, inside their service areas, not their own parcel, not currently being
// offered to another rider, and booked within the last POOL_MAX_AGE_H. Never in the pool:
// cancelled, active (assigned … arrived_dropoff), finished, failed or returning deliveries.
//
// Claiming is one transaction: lock the rider, re-check every rule (approval, vehicle, area,
// wallet), then `UPDATE … WHERE status = 'requested'`. Only one rider's update can match; the
// one-active-job index stops a rider from holding two. A loser gets OFFER_GONE and refreshes.
import { and, desc, eq, gt, inArray, ne, notExists, sql } from 'drizzle-orm';
import {
  ACTIVE_RIDER_STATUSES,
  haversineKm,
  type PoolOffer,
  type RiderPool,
} from '@dp/shared';
import type { Db } from '../../db/client.ts';
import { deliveries, deliveryEvents, deliveryOffers, riders } from '../../db/schema.ts';
import { AppError, isUniqueViolation } from '../../shared/errors.ts';
import { walletEligibility } from '../wallet/wallet.ts';
import { assertRiderCanTakeJob, coversArea, deliveryArea, riderAreas } from './eligibility.ts';

const POOL_MAX_AGE_H = 24;
const POOL_LIMIT = 30;

export async function riderPool(db: Db, riderId: string, now: Date): Promise<RiderPool> {
  const [r] = await db.select().from(riders).where(eq(riders.userId, riderId));
  const wallet = await walletEligibility(db, riderId);
  if (!r || r.approvalStatus !== 'approved') {
    return { offers: [], wallet, blockedReason: 'not_approved' };
  }
  const [busy] = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(
      and(eq(deliveries.riderId, riderId), inArray(deliveries.status, [...ACTIVE_RIDER_STATUSES])),
    )
    .limit(1);

  const areas = await riderAreas(db, riderId);
  const availableSince = sql<string>`coalesce((select max(e.created_at) from ${deliveryEvents} e where e.delivery_id = "deliveries"."id" and e.to_status = 'requested'), ${deliveries.createdAt})`;
  const rows = await db
    .select({ d: deliveries, since: availableSince })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.status, 'requested'),
        eq(deliveries.vehicleType, r.vehicleType),
        ne(deliveries.customerId, riderId),
        gt(deliveries.createdAt, new Date(now.getTime() - POOL_MAX_AGE_H * 3_600_000)),
        // Hidden while a push offer to another rider is open (it may come back in seconds).
        notExists(
          db
            .select({ one: sql`1` })
            .from(deliveryOffers)
            .where(
              and(
                eq(deliveryOffers.deliveryId, deliveries.id),
                eq(deliveryOffers.status, 'offered'),
                gt(deliveryOffers.expiresAt, now),
                ne(deliveryOffers.riderId, riderId),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(deliveries.createdAt))
    .limit(200);

  const from =
    r.currentLat != null && r.currentLng != null
      ? { lat: r.currentLat, lng: r.currentLng }
      : r.homeLat != null && r.homeLng != null
        ? { lat: r.homeLat, lng: r.homeLng }
        : null;
  const home =
    r.homeLat != null && r.homeLng != null
      ? { lat: r.homeLat, lng: r.homeLng, radiusKm: r.homeRadiusKm ?? 3 }
      : null;

  const offers: PoolOffer[] = rows
    .map(({ d, since }) => ({ d, since, area: deliveryArea(d) }))
    .filter((x) => coversArea(areas, x.area))
    .map(({ d, since, area }) => {
      const pickup = { lat: d.pickupLat, lng: d.pickupLng };
      return {
        deliveryId: d.id,
        code: d.publicCode,
        vehicleType: d.vehicleType,
        area,
        pickup: {
          address: d.pickupAddress,
          subCity: d.pickupSubCity,
          lat: d.pickupLat,
          lng: d.pickupLng,
          notes: d.pickupNotes,
        },
        dropoff: {
          address: d.dropoffAddress,
          subCity: d.dropoffSubCity,
          lat: d.dropoffLat,
          lng: d.dropoffLng,
          notes: d.dropoffNotes,
        },
        parcel: { description: d.parcelDescription, size: d.parcelSize },
        distanceKm: d.distanceKm,
        distanceSource: d.distanceSource,
        etaMin: d.etaMin,
        toPickupKm: from ? Math.round(haversineKm(from, pickup) * 10) / 10 : null,
        fare: d.fareAmount,
        commission: d.commissionAmount,
        riderEarning: d.riderEarning,
        payer: d.payer,
        availableSince: new Date(since).toISOString(),
        nearHome: !!home && haversineKm(home, pickup) <= home.radiusKm,
      };
    })
    .sort(
      (a, b) =>
        Number(b.nearHome) - Number(a.nearHome) ||
        (a.toPickupKm ?? Infinity) - (b.toPickupKm ?? Infinity) ||
        a.availableSince.localeCompare(b.availableSince),
    )
    .slice(0, POOL_LIMIT);

  return {
    offers,
    wallet,
    blockedReason: busy ? 'busy' : !wallet.canTakeWork ? 'wallet' : null,
  };
}

/** Atomic claim: exactly one rider can win a delivery; everyone else gets OFFER_GONE. */
export async function claimFromPool(
  db: Db,
  riderId: string,
  deliveryId: string,
  now: Date,
): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(deliveryId)) throw gone();
  try {
    await db.transaction(async (tx) => {
      const [d] = await tx.select().from(deliveries).where(eq(deliveries.id, deliveryId));
      if (!d || d.status !== 'requested') throw gone();
      const [heldByOther] = await tx
        .select({ id: deliveryOffers.id })
        .from(deliveryOffers)
        .where(
          and(
            eq(deliveryOffers.deliveryId, deliveryId),
            eq(deliveryOffers.status, 'offered'),
            gt(deliveryOffers.expiresAt, now),
            ne(deliveryOffers.riderId, riderId),
          ),
        )
        .limit(1);
      if (heldByOther) throw gone();
      await assertRiderCanTakeJob(tx, riderId, d);

      const [won] = await tx
        .update(deliveries)
        .set({
          riderId,
          status: 'assigned',
          assignedAt: now,
          updatedAt: now,
          version: sql`${deliveries.version} + 1`,
        })
        .where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, 'requested')))
        .returning({ id: deliveries.id });
      if (!won) throw gone();
      // Close open offers for this job, and any other offer this rider was holding.
      await tx
        .update(deliveryOffers)
        .set({ status: 'withdrawn', respondedAt: now })
        .where(
          and(
            eq(deliveryOffers.status, 'offered'),
            sql`(${deliveryOffers.deliveryId} = ${deliveryId} or ${deliveryOffers.riderId} = ${riderId})`,
          ),
        );
      await tx.insert(deliveryEvents).values({
        deliveryId,
        fromStatus: 'requested',
        toStatus: 'assigned',
        actorRole: 'rider',
        actorUserId: riderId,
        note: 'Claimed from the offer pool',
        metadata: { pool: true },
        createdAt: now,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, 'RIDER_BUSY', 'Finish your current job before taking another.');
    }
    throw err;
  }
  return deliveryId;
}

const gone = () =>
  new AppError(409, 'OFFER_GONE', 'Another rider took this job, or it is no longer available.');
