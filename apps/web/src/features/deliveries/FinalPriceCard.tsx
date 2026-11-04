import { CheckCircle2, Clock, MapPin, Route } from 'lucide-react';
import type { FinalFare } from '@dp/shared';
import { Badge, Panel } from '../../ui/index.ts';

const minutes = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'info' | 'neutral' }> = {
  due: { label: 'Waiting for payment', tone: 'warning' },
  collected: { label: 'Paid', tone: 'success' },
  disputed: { label: 'Being checked', tone: 'info' },
  waived: { label: 'Waived', tone: 'neutral' },
};

/**
 * The final price once the rider reached the destination: for the payer in their delivery
 * details, and on the public tracking page a receiver opens from the SMS (no app needed).
 */
export function FinalPriceCard({
  code,
  payer,
  finalFare,
  status,
  delivered,
}: {
  code: string;
  payer: 'sender' | 'receiver';
  finalFare: FinalFare;
  status: string;
  delivered: boolean;
}) {
  const s = STATUS[status] ?? STATUS.due!;
  return (
    <Panel className="overflow-hidden">
      <div className="bg-gradient-to-br from-accent to-accent-2 px-5 py-4 text-white">
        <p className="flex items-center gap-1.5 text-sm font-medium opacity-90">
          <CheckCircle2 className="size-4" aria-hidden />
          {delivered ? 'Delivered' : 'Your rider has arrived at the destination'}
        </p>
        <p className="mt-2 text-sm opacity-90">Final price · #{code}</p>
        <p className="text-4xl font-extrabold tracking-tight tabular">
          {finalFare.fare} <span className="text-lg font-bold opacity-90">ETB</span>
        </p>
        {finalFare.estimatedFare !== finalFare.fare && (
          <p className="text-sm opacity-80 tabular">Estimated at booking: {finalFare.estimatedFare} ETB</p>
        )}
      </div>
      <div className="flex flex-col gap-3 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{payer === 'sender' ? 'Paid by the sender' : 'Paid by the receiver'}</span>
          <Badge tone={s.tone} dot>
            {s.label}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-ink-2 tabular">
          <span className="inline-flex items-center gap-1.5">
            <Route className="size-4" aria-hidden /> {finalFare.actualDistanceKm.toFixed(1)} km
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-4" aria-hidden /> {minutes(finalFare.actualDurationMin)}
          </span>
          {finalFare.basis === 'estimate' && (
            <span className="inline-flex items-center gap-1.5 text-ink-3">
              <MapPin className="size-4" aria-hidden /> distance from booking
            </span>
          )}
        </div>
        {status === 'due' && !delivered && (
          <p className="text-ink-2">Pay the rider in cash, Telebirr or CBE Birr before taking the parcel.</p>
        )}
      </div>
    </Panel>
  );
}
