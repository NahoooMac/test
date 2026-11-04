import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { ACTIVE_RIDER_STATUSES, type PublicTracking } from '@dp/shared';
import type { Db } from '../../db/client.ts';
import { deliveries, deliveryEvents, payments, riders, users } from '../../db/schema.ts';
import { finalFareView } from '../deliveries/finalFare.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, tooManyRequests } from '../../shared/errors.ts';
import { consume } from '../../shared/rate-limit.ts';
import type { Authenticator } from '../auth/http.ts';
import type { RealtimeHub } from './hub.ts';

const CODE = /^[A-Z2-9]{6}$/;
/** Statuses during which the receiver may see the rider's phone number. */
const RIDER_CONTACT_VISIBLE = ['assigned', 'arrived_pickup', 'picked_up', 'arrived_dropoff'];

export async function realtimeRoutes(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Authenticator; hub: RealtimeHub },
) {
  const { db, clock, auth, hub } = deps;

  // Signed-in stream: the hub routes each event to the right users by id and role.
  app.get('/events', async (req, reply) => {
    const { user, session } = await auth.require(req, reply);
    reply.hijack();
    const close = hub.open(reply.raw, { userId: user.id, sessionId: session.id, role: user.role });
    req.raw.on('close', close);
  });

  const limitByIp = async (ip: string, key: string, limit: number) => {
    const r = await consume(db, { key: `track:${key}:${ip}`, windowSec: 60, limit }, clock.now());
    if (!r.allowed) throw tooManyRequests(r.retryAfterSec);
  };

  // Public tracking link: anyone with the code sees progress, never sender/receiver phone numbers.
  app.get<{ Params: { code: string } }>(
    '/track/:code',
    async (req, reply): Promise<PublicTracking> => {
      await limitByIp(req.ip, 'get', 60);
      reply.header('Cache-Control', 'no-store');
      return publicView(db, req.params.code.toUpperCase());
    },
  );

  app.get<{ Params: { code: string } }>('/track/:code/events', async (req, reply) => {
    await limitByIp(req.ip, 'stream', 20);
    const code = req.params.code.toUpperCase();
    await publicView(db, code); // 404 for unknown codes before opening a stream
    reply.hijack();
    const close = hub.open(reply.raw, {
      userId: null,
      sessionId: null,
      role: null,
      publicCode: code,
    });
    req.raw.on('close', close);
  });
}

async function publicView(db: Db, code: string): Promise<PublicTracking> {
  const notFound = new AppError(404, 'NOT_FOUND', 'No delivery with that code.');
  if (!CODE.test(code)) throw notFound;
  const [row] = await db
    .select({
      d: deliveries,
      rider: {
        vehicleType: riders.vehicleType,
        plate: riders.plateNumber,
        lat: riders.currentLat,
        lng: riders.currentLng,
        at: riders.locationUpdatedAt,
      },
      riderUser: { phone: users.phoneE164, name: users.fullName },
    })
    .from(deliveries)
    .leftJoin(riders, eq(riders.userId, deliveries.riderId))
    .leftJoin(users, eq(users.id, deliveries.riderId))
    .where(eq(deliveries.publicCode, code))
    .limit(1);
  if (!row) throw notFound;
  const d = row.d;
  const [fare] = await db
    .select({ status: payments.status })
    .from(payments)
    .where(and(eq(payments.deliveryId, d.id), eq(payments.kind, 'fare')));
  const finalFare = finalFareView(d);
  const events = await db
    .select({ status: deliveryEvents.toStatus, at: deliveryEvents.createdAt })
    .from(deliveryEvents)
    .where(eq(deliveryEvents.deliveryId, d.id))
    .orderBy(asc(deliveryEvents.createdAt));
  const active = (ACTIVE_RIDER_STATUSES as readonly string[]).includes(d.status);
  return {
    code: d.publicCode,
    status: d.status,
    // The amount to pay, once known (no names or phone numbers): the receiver's view of it.
    payment: finalFare ? { payer: d.payer, finalFare, status: fare?.status ?? 'due' } : null,
    vehicleType: d.vehicleType,
    etaMin: d.etaMin,
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
    rider:
      d.riderId && row.rider && row.riderUser
        ? {
            firstName: row.riderUser.name?.split(' ')[0] ?? null,
            vehicleType: row.rider.vehicleType,
            plate: row.rider.plate,
            phone: RIDER_CONTACT_VISIBLE.includes(d.status) ? row.riderUser.phone : null,
          }
        : null,
    riderLocation:
      active && row.rider?.lat != null && row.rider.lng != null && row.rider.at
        ? { lat: row.rider.lat, lng: row.rider.lng, at: row.rider.at.toISOString() }
        : null,
    timeline: events.map((e) => ({ status: e.status, at: e.at.toISOString() })),
    updatedAt: d.updatedAt.toISOString(),
  };
}
