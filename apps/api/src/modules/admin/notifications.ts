// Admin notification feed: recent delivery updates plus everything waiting for an admin. Built from
// the records that already exist (delivery events, payments, top-ups, KYC, ratings), so it needs no
// table of its own and can never disagree with them.
import type { FastifyInstance } from 'fastify';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { AdminNotification, AdminNotifications, DeliveryStatus } from '@dp/shared';
import type { Db } from '../../db/client.ts';
import {
  deliveries,
  deliveryEvents,
  deliveryRatings,
  payments,
  riders,
  users,
  walletTopups,
} from '../../db/schema.ts';
import type { Authenticator } from '../auth/http.ts';

const FEED_LIMIT = 40;

const FEED_STATUSES = [
  'requested',
  'assigned',
  'arrived_pickup',
  'picked_up',
  'arrived_dropoff',
  'delivered',
  'cancelled',
  'failed',
  'returned',
] as const satisfies readonly DeliveryStatus[];

const STATUS_TEXT: Record<(typeof FEED_STATUSES)[number], string> = {
  requested: 'New delivery booked',
  assigned: 'Rider assigned',
  arrived_pickup: 'Rider reached the pickup',
  picked_up: 'Ride started',
  arrived_dropoff: 'Rider reached the destination',
  delivered: 'Delivery completed',
  cancelled: 'Delivery cancelled',
  failed: 'Delivery failed',
  returned: 'Parcel returned to sender',
};

const METHOD = { cash: 'Cash', telebirr: 'Telebirr', cbe_birr: 'CBE Birr' } as const;

export async function adminNotifications(db: Db): Promise<AdminNotifications> {
  const [events, pays, topups, kyc, ratings] = await Promise.all([
    db
      .select({
        id: deliveryEvents.id,
        status: deliveryEvents.toStatus,
        at: deliveryEvents.createdAt,
        deliveryId: deliveries.id,
        code: deliveries.publicCode,
        fare: deliveries.fareAmount,
        rider: users.fullName,
      })
      .from(deliveryEvents)
      .innerJoin(deliveries, eq(deliveries.id, deliveryEvents.deliveryId))
      .leftJoin(users, eq(users.id, deliveries.riderId))
      .where(inArray(deliveryEvents.toStatus, [...FEED_STATUSES]))
      .orderBy(desc(deliveryEvents.createdAt))
      .limit(FEED_LIMIT),
    db
      .select({ p: payments, code: deliveries.publicCode })
      .from(payments)
      .innerJoin(deliveries, eq(deliveries.id, payments.deliveryId))
      .where(
        sql`${payments.kind} = 'fare' and (${payments.status} = 'disputed' or ${payments.verification} = 'pending')`,
      )
      .orderBy(desc(payments.updatedAt))
      .limit(FEED_LIMIT),
    db
      .select({ t: walletTopups, name: users.fullName })
      .from(walletTopups)
      .innerJoin(users, eq(users.id, walletTopups.riderId))
      .where(eq(walletTopups.status, 'pending'))
      .orderBy(desc(walletTopups.createdAt))
      .limit(FEED_LIMIT),
    db
      .select({ id: riders.userId, at: riders.kycSubmittedAt, name: users.fullName })
      .from(riders)
      .innerJoin(users, eq(users.id, riders.userId))
      .where(eq(riders.kycStatus, 'pending_review'))
      .orderBy(desc(riders.kycSubmittedAt))
      .limit(FEED_LIMIT),
    db
      .select({ id: deliveryRatings.deliveryId, at: deliveryRatings.reportedAt, code: deliveries.publicCode, stars: deliveryRatings.stars })
      .from(deliveryRatings)
      .innerJoin(deliveries, eq(deliveries.id, deliveryRatings.deliveryId))
      .where(eq(deliveryRatings.status, 'reported'))
      .orderBy(desc(deliveryRatings.reportedAt))
      .limit(FEED_LIMIT),
  ]);

  const action: AdminNotification[] = [
    ...pays.map(({ p, code }) => ({
      id: `payment:${p.id}:${p.status}`,
      kind: 'payment' as const,
      title: p.status === 'disputed' ? `Payment disputed · #${code}` : `Check transfer · #${code}`,
      body: `${p.amount} ETB${p.method ? ` · ${METHOD[p.method]}` : ''}${p.reference ? ` · ${p.reference}` : ''}`,
      at: p.updatedAt.toISOString(),
      link: `/admin/deliveries/${p.deliveryId}`,
      needsAction: true,
    })),
    ...topups.map(({ t, name }) => ({
      id: `topup:${t.id}`,
      kind: 'topup' as const,
      title: 'Top-up to verify',
      body: `${name ?? 'Rider'} · ${t.amount} ETB · ${METHOD[t.method]}`,
      at: t.createdAt.toISOString(),
      link: '/admin/topups',
      needsAction: true,
    })),
    ...kyc.map((k) => ({
      id: `kyc:${k.id}:${k.at?.getTime() ?? 0}`,
      kind: 'kyc' as const,
      title: 'Rider verification to review',
      body: k.name ?? 'New rider',
      at: (k.at ?? new Date(0)).toISOString(),
      link: `/admin/verification/${k.id}`,
      needsAction: true,
    })),
    ...ratings.map((r) => ({
      id: `rating:${r.id}`,
      kind: 'rating' as const,
      title: `Rating reported · #${r.code}`,
      body: `${r.stars} star${r.stars === 1 ? '' : 's'}`,
      at: (r.at ?? new Date(0)).toISOString(),
      link: '/admin/ratings',
      needsAction: true,
    })),
  ];
  const updates: AdminNotification[] = events.map((e) => ({
    id: `event:${e.id}`,
    kind: 'delivery',
    title: `${STATUS_TEXT[e.status as keyof typeof STATUS_TEXT]} · #${e.code}`,
    body: [e.rider, e.status === 'arrived_dropoff' || e.status === 'delivered' ? `${e.fare} ETB` : null]
      .filter(Boolean)
      .join(' · '),
    at: e.at.toISOString(),
    link: `/admin/deliveries/${e.deliveryId}`,
    needsAction: false,
  }));
  return {
    items: [...action, ...updates].sort((a, b) => b.at.localeCompare(a.at)).slice(0, FEED_LIMIT),
    actionCount: action.length,
  };
}

export async function adminNotificationRoutes(
  app: FastifyInstance,
  deps: { db: Db; auth: Authenticator },
) {
  app.get('/admin/notifications', async (req, reply): Promise<AdminNotifications> => {
    await deps.auth.require(req, reply, 'admin');
    reply.header('Cache-Control', 'no-store');
    return adminNotifications(deps.db);
  });
}
