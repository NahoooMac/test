// The rider's screen after "End delivery": the final price, who pays (with a call button), and Done.
// The amount always comes from the server (calculated from the actual route and journey time);
// nothing here can change it. "Show price to customer" turns the phone into a large price
// display, so a receiver without the app (or internet) can read the amount. Done confirms in one
// tap that the money was received and the parcel handed over; the server records it.
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Clock, MapPin, MonitorSmartphone, Phone, Route } from 'lucide-react';
import type { RiderJob } from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import { Badge, Button, Notice, Panel } from '../../ui/index.ts';
import { riderHomeKey } from './hooks.ts';
import { riderKeys, useRiderCopy } from './features.ts';

export const minutesLabel = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);

export function DestinationPayment({ job, unreachable }: { job: RiderJob; unreachable: ReactNode }) {
  const c = useRiderCopy();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showing, setShowing] = useState(false);
  const f = job.finalFare!;
  const payer = job.payerContact;

  const finish = useMutation({
    mutationFn: () =>
      api<RiderJob>(`/rider/jobs/${job.id}/complete`, {
        method: 'POST',
        body: { handoverConfirmed: true, paymentReceived: true },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: riderHomeKey });
      void qc.invalidateQueries({ queryKey: riderKeys.wallet });
      void qc.invalidateQueries({ queryKey: riderKeys.pool });
      navigate('/rider');
    },
  });

  if (showing) return <PriceDisplay job={job} onBack={() => setShowing(false)} />;

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pt-5 pb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-ink-3 tabular">#{job.code}</p>
          <h1 className="text-[24px] font-bold tracking-tight">{t('rider.job.atDropoff')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={payer.role === 'sender' ? 'info' : 'accent'}>
            {payer.role === 'sender' ? c.pay.sender : c.pay.receiver}
          </Badge>
          <a
            href={`tel:${payer.phone}`}
            aria-label={c.pay.callPayer}
            title={c.pay.callPayer}
            className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-ink shadow-[var(--shadow-sm)] active:scale-95"
          >
            <Phone className="size-5" aria-hidden />
          </a>
        </div>
      </div>

      {/* The price: large, read-only. */}
      <Panel className="overflow-hidden">
        <div className="bg-gradient-to-br from-accent to-accent-2 px-5 py-5 text-white">
          <p className="text-sm font-medium opacity-90">{c.pay.finalPrice}</p>
          <p className="text-[44px] leading-none font-extrabold tracking-tight tabular" aria-live="polite">
            {f.fare} <span className="text-xl font-bold opacity-90">ETB</span>
          </p>
          {f.estimatedFare !== f.fare && (
            <p className="mt-1 text-sm opacity-80 tabular">
              {c.pay.estimated}: {f.estimatedFare} ETB
            </p>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
          <div>
            <dt className="flex items-center gap-1 text-ink-3">
              <Route className="size-3.5" aria-hidden /> {c.pay.distance}
            </dt>
            <dd className="font-semibold tabular">{f.actualDistanceKm.toFixed(2)} km</dd>
            <dd className="text-xs text-ink-3">{f.basis === 'gps' ? c.pay.gps : c.pay.estimateBasis}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-ink-3">
              <Clock className="size-3.5" aria-hidden /> {c.pay.duration}
            </dt>
            <dd className="font-semibold tabular">{minutesLabel(f.actualDurationMin)}</dd>
          </div>
        </dl>
        <div className="px-4 pb-4">
          <Button
            block
            size="lg"
            variant="secondary"
            icon={<MonitorSmartphone className="size-5" aria-hidden />}
            onClick={() => setShowing(true)}
          >
            {c.pay.showCustomer}
          </Button>
        </div>
      </Panel>

      {unreachable}

      <div className="mt-auto flex flex-col gap-2">
        {finish.error && (
          <Notice tone="danger">
            {finish.error instanceof ApiRequestError ? finish.error.message : String(finish.error)}
          </Notice>
        )}
        <p className="text-center text-sm text-ink-3">{c.pay.doneHint}</p>
        <Button size="lg" block loading={finish.isPending} onClick={() => finish.mutate()} className="h-16 text-lg">
          {c.pay.done}
        </Button>
      </div>
    </div>
  );
}

/** Full-screen, read-only price for the customer to read off the rider's phone. */
function PriceDisplay({ job, onBack }: { job: RiderJob; onBack: () => void }) {
  const c = useRiderCopy();
  const f = job.finalFare!;
  const p = job.farePayment;
  return (
    <div role="dialog" aria-modal="true" aria-label={c.pay.pleasePay} className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-accent to-[#1e3a8a] px-6 pt-safe pb-safe text-white">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        <p className="text-sm font-semibold tracking-[0.2em] uppercase opacity-80">#{job.code}</p>
        <p className="text-2xl font-bold">{c.pay.pleasePay}</p>
        <p className="text-[clamp(64px,22vw,120px)] leading-none font-extrabold tracking-tight tabular">{f.fare}</p>
        <p className="text-3xl font-bold opacity-90">ETB</p>
        <div className="mt-2 rounded-2xl bg-white/12 px-5 py-3 text-lg font-semibold">
          {job.payerContact.role === 'sender' ? c.pay.sender : c.pay.receiver}
        </div>
        <div className="flex gap-6 text-base opacity-90 tabular">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-4" aria-hidden /> {f.actualDistanceKm.toFixed(1)} km
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-4" aria-hidden /> {minutesLabel(f.actualDurationMin)}
          </span>
        </div>
        <p className="text-lg font-medium">{c.pay.methods}</p>
        <p className="text-base opacity-90">
          {c.pay.status}: {p ? c.pay.statuses[p.status] : c.pay.statuses.none}
        </p>
      </div>
      <Button
        size="lg"
        block
        variant="secondary"
        className="mb-4"
        icon={<ArrowLeft className="size-5" aria-hidden />}
        onClick={onBack}
      >
        {c.pay.back}
      </Button>
    </div>
  );
}
