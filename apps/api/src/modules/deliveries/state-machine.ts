// The only place that decides which status changes are legal, and who may make them.
import type { ActorRole, DeliveryStatus } from '@dp/shared';

type Transitions = Record<DeliveryStatus, Partial<Record<DeliveryStatus, readonly ActorRole[]>>>;

const TRANSITIONS: Transitions = {
  requested: { assigned: ['system', 'admin'], cancelled: ['customer', 'admin'] },
  // A rider who can no longer do the job releases it back to `requested`.
  assigned: {
    arrived_pickup: ['rider'],
    requested: ['rider', 'admin', 'system'],
    cancelled: ['customer', 'admin'],
  },
  arrived_pickup: { picked_up: ['rider'], cancelled: ['customer', 'admin'] },
  picked_up: { arrived_dropoff: ['rider'] },
  arrived_dropoff: { delivered: ['rider', 'admin'], failed: ['rider', 'admin'] },
  failed: { returning: ['rider', 'admin', 'system'] },
  returning: { returned: ['rider', 'admin'] },
  delivered: {},
  cancelled: {},
  returned: {},
};

export function canTransition(from: DeliveryStatus, to: DeliveryStatus, actor: ActorRole): boolean {
  return TRANSITIONS[from][to]?.includes(actor) ?? false;
}

export function nextStatuses(from: DeliveryStatus, actor: ActorRole): DeliveryStatus[] {
  return (Object.keys(TRANSITIONS[from]) as DeliveryStatus[]).filter((to) =>
    canTransition(from, to, actor),
  );
}

export const TERMINAL: readonly DeliveryStatus[] = ['delivered', 'cancelled', 'returned'];

/** Column stamped when a delivery enters the status. */
export const STATUS_TIMESTAMP = {
  assigned: 'assignedAt',
  arrived_pickup: 'arrivedPickupAt',
  picked_up: 'pickedUpAt',
  arrived_dropoff: 'arrivedDropoffAt',
  delivered: 'deliveredAt',
  cancelled: 'cancelledAt',
  failed: 'failedAt',
  returned: 'returnedAt',
} as const satisfies Partial<Record<DeliveryStatus, string>>;

/**
 * Customer cancellation fee for the current status (business rule):
 *  - before the rider arrives at pickup: 0 ETB
 *  - after arrival, before pickup: the vehicle's fee (bicycle 25, motorcycle 40), all to the rider
 *  - once picked up: the customer can no longer cancel (null)
 */
export function customerCancellationFee(
  status: DeliveryStatus,
  feeAfterArrival: string,
): string | null {
  if (status === 'requested' || status === 'assigned') return '0.00';
  if (status === 'arrived_pickup') return feeAfterArrival;
  return null;
}
