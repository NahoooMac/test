import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { ACTIVE_RIDER_STATUSES, OPEN_DELIVERY_STATUSES } from '@dp/shared';
import type { Db } from '../../db/client.ts';
import { deliveries, deliveryOffers, riders, users } from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import type { Authenticator } from '../auth/http.ts';

/** Waiting longer than this without a rider is flagged for an operator. */
export const ATTENTION_AFTER_SEC = 5 * 60;

export async function adminOpsRoutes(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Authenticator },
) {
  const { db, clock, auth } = deps;

  // Snapshot for the live operations board; the page refreshes it on "ops"/"delivery" events.
  app.get('/admin/ops', async (req, reply) => {
    await auth.require(req, reply, 'admin');
    reply.header('Cache-Control', 'no-store');
    const now = clock.now();

    const open = await db
      .select({
        d: deliveries,
        riderName: users.fullName,
      })
      .from(deliveries)
      .leftJoin(users, eq(users.id, deliveries.riderId))
      .where(inArray(deliveries.status, [...OPEN_DELIVERY_STATUSES]))
      .orderBy(asc(deliveries.createdAt))
      .limit(300);

    const busy = new Set(
      open
        .filter((o) => (ACTIVE_RIDER_STATUSES as readonly string[]).includes(o.d.status))
        .map((o) => o.d.riderId),
    );
    const busyIds = [...busy].filter((x): x is string => !!x);
    const offered = new Set(
      (
        await db
          .select({ riderId: deliveryOffers.riderId })
          .from(deliveryOffers)
          .where(eq(deliveryOffers.status, 'offered'))
      ).map((o) => o.riderId),
    );

    const riderRows = await db
      .select({ r: riders, name: users.fullName, phone: users.phoneE164 })
      .from(riders)
      .innerJoin(users, eq(users.id, riders.userId))
      .where(
        and(
          eq(riders.approvalStatus, 'approved'),
          // Online riders, plus anyone still finishing a job after going offline.
          busyIds.length
            ? or(eq(riders.isOnline, true), inArray(riders.userId, busyIds))
            : eq(riders.isOnline, true),
        ),
      )
      .limit(500);

    return {
      generatedAt: now.toISOString(),
      riders: riderRows.map(({ r, name, phone }) => ({
        id: r.userId,
        name,
        phone,
        vehicleType: r.vehicleType,
        plate: r.plateNumber,
        isOnline: r.isOnline,
        lat: r.currentLat,
        lng: r.currentLng,
        locationUpdatedAt: r.locationUpdatedAt?.toISOString() ?? null,
        state: busy.has(r.userId) ? 'on_job' : offered.has(r.userId) ? 'offered' : 'idle',
      })),
      deliveries: open.map(({ d, riderName }) => {
        const waitingSec = Math.floor((now.getTime() - d.createdAt.getTime()) / 1000);
        return {
          id: d.id,
          code: d.publicCode,
          status: d.status,
          vehicleType: d.vehicleType,
          pickup: { address: d.pickupAddress, lat: d.pickupLat, lng: d.pickupLng },
          dropoff: { address: d.dropoffAddress, lat: d.dropoffLat, lng: d.dropoffLng },
          fare: d.fareAmount,
          riderName,
          createdAt: d.createdAt.toISOString(),
          waitingSec,
          needsAttention: d.status === 'requested' && waitingSec > ATTENTION_AFTER_SEC,
        };
      }),
    };
  });
}
