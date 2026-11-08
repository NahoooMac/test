// Rider profile photos: the front-face capture an admin approved in KYC, shown so customers and
// receivers can recognise their rider. Served only to people with a reason to see it:
//  - admins, and the rider themself;
//  - a customer whose delivery that rider took;
//  - anyone holding the public tracking code, only while the rider is on that job (the same rule
//    as the rider's phone number on the tracking page).
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { deliveries, riderPhotos, riders } from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, tooManyRequests } from '../../shared/errors.ts';
import { consume } from '../../shared/rate-limit.ts';
import type { Authenticator } from '../auth/http.ts';

const notFound = () => new AppError(404, 'NOT_FOUND', 'No photo.');
const UUID = /^[0-9a-f-]{36}$/i;
const CODE = /^[A-Z2-9]{6}$/;
/** Same statuses during which the tracking page shows the rider's phone number. */
const ON_THE_JOB = ['assigned', 'arrived_pickup', 'picked_up', 'arrived_dropoff'] as const;

/** URL of a rider's photo for signed-in viewers (null when there is none). */
export const riderPhotoUrl = (riderId: string, at: Date | null | undefined) =>
  at ? `/api/riders/${riderId}/photo?v=${at.getTime()}` : null;

/** URL of the rider's photo for the public tracking page (null when there is none). */
export const trackPhotoUrl = (code: string, at: Date | null | undefined) =>
  at ? `/api/track/${code}/rider-photo?v=${at.getTime()}` : null;

export async function riderPhotoRoutes(app: FastifyInstance, deps: { db: Db; clock: Clock; auth: Authenticator }) {
  const { db, clock, auth } = deps;

  const send = async (reply: FastifyReply, riderId: string, cache: string) => {
    const [p] = await db.select().from(riderPhotos).where(eq(riderPhotos.riderId, riderId));
    if (!p) throw notFound();
    return reply
      .header('Cache-Control', cache)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .type(p.mime)
      .send(Buffer.from(p.data, 'base64'));
  };

  app.get<{ Params: { id: string } }>('/riders/:id/photo', async (req, reply) => {
    const { user } = await auth.require(req, reply);
    const riderId = req.params.id;
    if (!UUID.test(riderId)) throw notFound();
    let allowed = user.role === 'admin' || user.id === riderId;
    if (!allowed) {
      const [d] = await db
        .select({ id: deliveries.id })
        .from(deliveries)
        .where(and(eq(deliveries.customerId, user.id), eq(deliveries.riderId, riderId), ne(deliveries.status, 'requested')))
        .limit(1);
      allowed = !!d;
    }
    if (!allowed) throw notFound();
    return send(reply, riderId, 'private, max-age=600');
  });

  app.get<{ Params: { code: string } }>('/track/:code/rider-photo', async (req, reply) => {
    const r = await consume(db, { key: `track:photo:${req.ip}`, windowSec: 60, limit: 30 }, clock.now());
    if (!r.allowed) throw tooManyRequests(r.retryAfterSec);
    const code = req.params.code.toUpperCase();
    if (!CODE.test(code)) throw notFound();
    const [d] = await db
      .select({ riderId: deliveries.riderId, status: deliveries.status })
      .from(deliveries)
      .where(eq(deliveries.publicCode, code));
    if (!d?.riderId || !(ON_THE_JOB as readonly string[]).includes(d.status)) throw notFound();
    const [rider] = await db.select({ at: riders.photoUpdatedAt }).from(riders).where(eq(riders.userId, d.riderId));
    if (!rider?.at) throw notFound();
    return send(reply, d.riderId, 'no-store');
  });
}
