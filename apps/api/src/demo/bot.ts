import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client.ts';
import { deliveries, deliveryOffers, riders, users } from '../db/schema.ts';
import type { DeliveryService } from '../modules/deliveries/service.ts';
import type { RiderService } from '../modules/riders/service.ts';
import type { Clock } from '../shared/clock.ts';
import { DEMO_PHONES } from './accounts.ts';

const BOLE_PICKUP = {
  lat: 9.0127,
  lng: 38.7896,
  address: 'Bole Road, Addis Ababa',
  subCity: 'bole',
  contactName: 'Demo Sender',
  contactPhone: '+251900000002',
  notes: '',
};

const MESKEL_DROPOFF = {
  lat: 9.0107,
  lng: 38.7612,
  address: 'Meskel Square, Addis Ababa',
  subCity: 'kirkos',
  contactName: 'Demo Receiver',
  contactPhone: '+251911000000',
  notes: 'Demo delivery',
};

export class DemoBot {
  timer: ReturnType<typeof setInterval> | null = null;
  db: Db;
  clock: Clock;
  deliveries: DeliveryService;
  riders: RiderService;
  log: FastifyBaseLogger;

  constructor(
    db: Db,
    clock: Clock,
    deliveries: DeliveryService,
    riders: RiderService,
    log: FastifyBaseLogger,
  ) {
    this.db = db;
    this.clock = clock;
    this.deliveries = deliveries;
    this.riders = riders;
    this.log = log;
  }

  start(): void {
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log.error({ err }, 'demo bot tick failed'));
    }, 5_000);
    this.log.info('demo bot started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    await this.autoAcceptForDemoRider();
    await this.autoCreateForDemoRider();
  }

  async autoAcceptForDemoRider(): Promise<void> {
    const [riderUser] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phoneE164, DEMO_PHONES.rider));
    if (!riderUser) return;

    const now = this.clock.now();
    const [offer] = await this.db
      .select({ id: deliveryOffers.id })
      .from(deliveryOffers)
      .where(
        and(
          eq(deliveryOffers.riderId, riderUser.id),
          eq(deliveryOffers.status, 'offered'),
        ),
      )
      .limit(1);

    if (offer) {
      try {
        await this.riders.accept(riderUser.id, offer.id);
        this.log.info('demo bot: rider auto-accepted offer %s', offer.id);
      } catch {
        // offer may have expired or been taken
      }
    }
  }

  async autoCreateForDemoRider(): Promise<void> {
    const [riderUser] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phoneE164, DEMO_PHONES.rider));
    if (!riderUser) return;

    const [rider] = await this.db
      .select({ isOnline: riders.isOnline })
      .from(riders)
      .where(eq(riders.userId, riderUser.id));
    if (!rider?.isOnline) return;

    // Check if rider already has an active delivery or a pending offer
    const [activeDelivery] = await this.db
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.riderId, riderUser.id),
          isNull(deliveries.deliveredAt),
        ),
      )
      .limit(1);
    if (activeDelivery) return;

    // Check if there's already a waiting delivery for the demo customer
    const [customerUser] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phoneE164, DEMO_PHONES.customer));
    if (!customerUser) return;

    const [waitingDelivery] = await this.db
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.customerId, customerUser.id),
          eq(deliveries.status, 'requested'),
        ),
      )
      .limit(1);
    if (waitingDelivery) return;

    try {
      await this.deliveries.create(
        customerUser.id,
        {
          pickup: BOLE_PICKUP,
          dropoff: MESKEL_DROPOFF,
          vehicleType: 'motorcycle',
          parcel: { description: 'Demo package', size: 'small' },
          payer: 'sender',
          preferredPaymentMethod: 'cash',
        },
        `demo-${Date.now()}`,
      );
      this.log.info('demo bot: created delivery for online demo rider');
    } catch (err) {
      this.log.warn({ err }, 'demo bot: failed to create delivery');
    }
  }
}
