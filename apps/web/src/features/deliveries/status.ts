import type { DeliveryStatus } from '@dp/shared';
import type { Tone } from '../../ui/index.ts';

export const STATUS_TONE: Record<DeliveryStatus, Tone> = {
  requested: 'neutral',
  assigned: 'info',
  arrived_pickup: 'info',
  picked_up: 'accent',
  arrived_dropoff: 'accent',
  delivered: 'success',
  cancelled: 'neutral',
  failed: 'danger',
  returning: 'warning',
  returned: 'warning',
};

export const STAGE_KEYS = ['booked', 'assigned', 'pickup', 'onTheWay', 'delivered'] as const;

/** Index into STAGE_KEYS of the stage in progress; STAGE_KEYS.length when finished. */
export function stageIndex(status: DeliveryStatus): number {
  switch (status) {
    case 'requested':
      return 1;
    case 'assigned':
    case 'arrived_pickup':
      return 2;
    case 'picked_up':
      return 3;
    case 'arrived_dropoff':
      return 4;
    case 'delivered':
      return 5;
    default:
      return -1; // cancelled / failed / returned: progress bar is not shown
  }
}

export const isOpen = (s: DeliveryStatus) =>
  !['delivered', 'cancelled', 'returned', 'failed'].includes(s);

export const vehicleLabel = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
