// Tells the selected payer the final price once the rider reaches the destination.
//
// The payer is the one chosen at booking and is never changed here:
//  - sender:   the customer who booked (always has an account) → SMS + in-app notice;
//  - receiver: the drop-off contact → SMS, plus an in-app notice if that phone has an account.
// The SMS carries the delivery code and the public tracking link, so a receiver without the app
// can see the price. Sending happens after the database commit and never blocks the rider: a
// failed SMS is logged and can be resent; the rider's own screen shows the price regardless.
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../../db/client.ts';
import { deliveries, users } from '../../db/schema.ts';
import type { SmsProvider } from '../../integrations/sms/types.ts';
import type { Realtime } from '../realtime/hub.ts';

export interface PayerNotifierDeps {
  db: Db;
  sms: SmsProvider | null;
  realtime: Realtime;
  appOrigin: string;
  log?: Pick<FastifyBaseLogger, 'warn' | 'info'>;
}

export interface PayerTarget {
  role: 'sender' | 'receiver';
  phone: string;
  name: string | null;
  /** The payer's account, when they have one. */
  userId: string | null;
}

/** Who pays this delivery and how to reach them (the booking's choice, never inferred). */
export async function payerTarget(db: Db, d: typeof deliveries.$inferSelect): Promise<PayerTarget> {
  if (d.payer === 'sender') {
    const [c] = await db
      .select({ id: users.id, phone: users.phoneE164, name: users.fullName })
      .from(users)
      .where(eq(users.id, d.customerId));
    return { role: 'sender', phone: c!.phone, name: c!.name, userId: c!.id };
  }
  const [account] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.phoneE164, d.dropoffContactPhone), eq(users.status, 'active')));
  return {
    role: 'receiver',
    phone: d.dropoffContactPhone,
    name: d.dropoffContactName || null,
    userId: account?.id ?? null,
  };
}

export function finalPriceSms(code: string, fare: string, link: string) {
  return (
    `Delivery #${code} has arrived. Amount to pay the rider: ${fare} ETB ` +
    `(cash, Telebirr or CBE Birr). Details: ${link}`
  );
}

export class PayerNotifier {
  private readonly deps: PayerNotifierDeps;

  constructor(deps: PayerNotifierDeps) {
    this.deps = deps;
  }

  /** Sends the final price to the payer once; returns whether the SMS went out. */
  async finalPrice(deliveryId: string, now: Date): Promise<boolean> {
    const { db, sms, realtime, appOrigin, log } = this.deps;
    const [d] = await db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
    if (!d || !d.fareFinalizedAt) return false;
    const target = await payerTarget(db, d);
    const link = `${appOrigin.replace(/\/$/, '')}/t/${d.publicCode}`;
    if (target.userId) {
      realtime.notifyUser(target.userId, 'notice', {
        kind: 'payment_due',
        deliveryId: target.role === 'sender' ? d.id : null,
        code: d.publicCode,
        fare: d.fareAmount,
        link: `/t/${d.publicCode}`,
      });
    }
    if (!sms || d.payerNotifiedAt) return false;
    try {
      await sms.send({ to: target.phone, text: finalPriceSms(d.publicCode, d.fareAmount, link) });
      await db
        .update(deliveries)
        .set({ payerNotifiedAt: now })
        .where(and(eq(deliveries.id, d.id), isNull(deliveries.payerNotifiedAt)));
      log?.info({ deliveryId, payer: target.role }, 'final price sent to payer');
      return true;
    } catch (err) {
      log?.warn({ err, deliveryId, payer: target.role }, 'final price SMS failed');
      return false;
    }
  }
}
