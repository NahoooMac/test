import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MapPin, Navigation, Phone, PhoneOff, Wallet } from 'lucide-react';
import {
  formatPhone,
  subCityName,
  type ContactOutcome,
  type DeliveryStatus,
  type PaymentMethod,
  type RiderJob,
} from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import { formatClock, useCountdown } from '../../lib/useCountdown.ts';
import { MapView, type MapMarker } from '../../map/MapView.tsx';
import { Badge, Button, ChoiceGroup, Notice, Panel, SwipeSlider, TextField, Timeline } from '../../ui/index.ts';
import { STATUS_TONE } from '../deliveries/status.ts';
import { riderHomeKey } from './hooks.ts';
import { NavigationView } from './NavigationView.tsx';
import { DestinationPayment, minutesLabel } from './DestinationPayment.tsx';
import { useRiderCopy } from './features.ts';
import { flushRoute } from './routeRecorder.ts';

const NEXT: Partial<
  Record<
    DeliveryStatus,
    'arrived_pickup' | 'picked_up' | 'arrived_dropoff' | 'delivered' | 'returned'
  >
> = {
  assigned: 'arrived_pickup',
  arrived_pickup: 'picked_up',
  picked_up: 'arrived_dropoff',
  arrived_dropoff: 'delivered',
  returning: 'returned',
};

const HEADLINE: Partial<Record<DeliveryStatus, string>> = {
  assigned: 'rider.job.toPickup',
  arrived_pickup: 'rider.job.atPickup',
  picked_up: 'rider.job.toDropoff',
  arrived_dropoff: 'rider.job.atDropoff',
  returning: 'rider.job.returning',
};

export function ActiveJob({
  job,
  position,
}: {
  job: RiderJob;
  position: { lat: number; lng: number } | null;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: riderHomeKey });
  const [showCalls, setShowCalls] = useState(false);
  const [navigating, setNavigating] = useState(false);

  const c = useRiderCopy();
  const step = useMutation({
    mutationFn: async (to: string) => {
      // The final fare uses the recorded route: upload any queued GPS fixes first.
      if (to === 'arrived_dropoff') await flushRoute().catch(() => undefined);
      return api(`/rider/jobs/${job.id}/step`, { method: 'POST', body: { to, ...position } });
    },
    onSettled: refresh,
  });
  const journeyMin = useElapsedMinutes(job.status === 'picked_up' ? job.pickedUpAt : null);
  const release = useMutation({
    mutationFn: () => api(`/rider/jobs/${job.id}/release`, { method: 'POST' }),
    onSettled: refresh,
  });
  const logCall = useMutation({
    mutationFn: (outcome: ContactOutcome) =>
      api(`/rider/jobs/${job.id}/contact-attempts`, { method: 'POST', body: { outcome } }),
    onSettled: refresh,
  });
  const fail = useMutation({
    mutationFn: () => api(`/rider/jobs/${job.id}/fail`, { method: 'POST' }),
    onSettled: refresh,
  });

  const headingToPickup =
    job.status === 'assigned' || job.status === 'arrived_pickup' || job.status === 'returning';
  const stop = headingToPickup ? job.pickup : job.dropoff;
  const navTarget = useMemo(
    () => ({ lat: stop.lat, lng: stop.lng, address: stop.address }),
    [stop.lat, stop.lng, stop.address],
  );
  const stopLabel =
    job.status === 'returning'
      ? t('rider.job.returnTo')
      : headingToPickup
        ? t('rider.job.collect')
        : t('rider.job.deliverTo');
  const next = NEXT[job.status];
  const failDeadline = useMemo(
    () => (job.canFailAt ? new Date(job.canFailAt).getTime() : 0),
    [job.canFailAt],
  );
  const failIn = useCountdown(failDeadline);
  // Payment is only collected at the destination (dedicated screen below), never at pickup.
  // A failed delivery's fare is still due; it's collected when the parcel goes back to the sender.
  const needsPayment = false;
  const collectHere = job.status === 'returning';
  const error = step.error ?? release.error ?? fail.error ?? logCall.error;
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(i18n.language === 'am' ? 'am-ET' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });

  const markers: MapMarker[] = [
    { id: 'p', point: job.pickup, kind: 'pickup' },
    { id: 'd', point: job.dropoff, kind: 'dropoff' },
    ...(position
      ? [{ id: 'me', point: position, kind: 'rider' as const, vehicleType: job.vehicleType }]
      : []),
  ];

  const unreachablePanel = job.status === 'arrived_dropoff' && (
    <Panel className="p-4">
      <button
        type="button"
        onClick={() => setShowCalls((v) => !v)}
        className="flex w-full items-center gap-2 text-left font-semibold"
        aria-expanded={showCalls}
      >
        <PhoneOff className="size-4 text-ink-3" aria-hidden />
        {t('rider.job.unreachable')}
      </button>
      {showCalls && (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-ink-2">{t('rider.job.failRule')}</p>
          <div className="flex flex-col gap-2">
            {(['no_answer', 'busy', 'unreachable'] as const).map((o) => (
              <Button
                key={o}
                variant="secondary"
                className="px-2 text-sm"
                onClick={() => logCall.mutate(o)}
                disabled={logCall.isPending}
              >
                {t(`rider.job.outcomes.${o}`)}
              </Button>
            ))}
          </div>
          {job.contactAttempts.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-ink-3 uppercase">
                {t('rider.job.attempts')}
              </p>
              <Timeline
                items={job.contactAttempts.map((a, i) => ({
                  id: `${a.at}-${i}`,
                  title: t(`rider.job.outcomes.${a.outcome}`),
                  time: time(a.at),
                  state: 'done' as const,
                }))}
              />
            </div>
          )}
          <Button
            variant="danger-soft"
            block
            onClick={() => fail.mutate()}
            loading={fail.isPending}
            disabled={!job.canFailAt || failIn > 0}
          >
            {job.canFailAt && failIn > 0
              ? t('rider.job.failIn', { time: formatClock(failIn) })
              : t('rider.job.fail')}
          </Button>
        </div>
      )}
    </Panel>
  );

  // At the destination: the dedicated payment screen (final price, payer, outcome, Done).
  if (job.status === 'arrived_dropoff' && job.finalFare) {
    return (
      <>
        {error && (
          <div className="px-4 pt-4">
            <Notice tone="danger">
              {error instanceof ApiRequestError ? error.message : String(error)}
            </Notice>
          </div>
        )}
        <DestinationPayment job={job} unreachable={unreachablePanel} />
      </>
    );
  }

  if (navigating) {
    return (
      <NavigationView
        target={navTarget}
        title={stopLabel}
        contactPhone={stop.contactPhone}
        position={position}
        vehicleType={job.vehicleType}
        onClose={() => setNavigating(false)}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="relative">
        <MapView
          className="h-[52vh] min-h-[300px]"
          markers={markers}
          line={[job.pickup, job.dropoff]}
          labels={{ pickup: t('booking.pickup'), dropoff: t('booking.dropoff') }}
          fit
        />
        <div className="pointer-events-none absolute top-4 right-4 flex flex-col items-end gap-2">
          <div className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-bold shadow-[var(--shadow-md)] tabular">
            <MapPin className="size-3.5 text-accent" aria-hidden />
            {job.distanceKm.toFixed(1)} km
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-navy px-3 py-1.5 text-xs font-bold text-navy-ink shadow-[var(--shadow-md)] tabular">
            <Wallet className="size-3.5 text-accent-2" aria-hidden />
            {job.riderEarning} ETB
          </div>
        </div>
      </div>
      <div className="relative z-10 -mt-7 flex flex-1 flex-col gap-4 rounded-t-[28px] bg-canvas px-4 pt-3 pb-4 shadow-[0_-10px_28px_rgba(15,23,42,0.10)]">
        <span className="mx-auto h-1.5 w-10 rounded-full bg-line-strong" aria-hidden />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight">
              {t(HEADLINE[job.status] ?? `delivery.statuses.${job.status}`)}
            </h1>
            <p className="mt-0.5 text-sm text-ink-3 tabular">
              #{job.code} · {job.distanceKm.toFixed(1)} km · {job.riderEarning} ETB
            </p>
          </div>
          <Badge tone={STATUS_TONE[job.status]} dot>
            {t(`booking.vehicles.${job.vehicleType}`)}
          </Badge>
        </div>

        <Panel className="p-4">
          <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">{stopLabel}</p>
          <p className="mt-0.5 text-[22px] leading-tight font-bold tracking-tight">{stop.address}</p>
          {stop.subCity && (
            <p className="text-sm text-ink-3">{subCityName(stop.subCity, i18n.language)}</p>
          )}
          <p className="mt-2 text-[15px] font-medium">
            {stop.contactName} · <span className="tabular">{formatPhone(stop.contactPhone)}</span>
          </p>
          {stop.notes && <p className="mt-1 text-sm text-ink-2">“{stop.notes}”</p>}
          <div className="mt-4 flex gap-2">
            <a
              href={`tel:${stop.contactPhone}`}
              aria-label={t('rider.job.call')}
              title={t('rider.job.call')}
              className="inline-flex size-13 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-accent-soft text-accent transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:brightness-95 active:scale-[0.97]"
            >
              <Phone className="size-5" aria-hidden />
            </a>
            <button
              type="button"
              onClick={() => setNavigating(true)}
              className="inline-flex h-13 flex-1 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-navy text-base font-semibold text-navy-ink shadow-[var(--shadow-md)] transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-navy-2 active:scale-[0.97]"
            >
              <Navigation className="size-5" aria-hidden />
              {t('rider.job.navigate')}
            </button>
          </div>
        </Panel>

        {job.farePayment ? (
          <Notice tone="success">
            {t('rider.job.payment.recorded', {
              method: t(`booking.methods.${job.farePayment.method}`),
            })}
          </Notice>
        ) : (
          collectHere && <PaymentPanel job={job} onDone={refresh} />
        )}

        {unreachablePanel}

        {job.status === 'picked_up' && (
          <Panel className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">{c.pay.journey}</p>
              <p className="text-2xl font-bold tabular">{minutesLabel(journeyMin)}</p>
            </div>
            <p className="max-w-[60%] text-right text-xs text-ink-3">{c.pay.endHint}</p>
          </Panel>
        )}

        {error && (
          <Notice tone="danger">
            {error instanceof ApiRequestError ? error.message : String(error)}
          </Notice>
        )}

        {job.status === 'assigned' && (
          <button
            type="button"
            onClick={() => release.mutate()}
            disabled={release.isPending}
            className="h-11 self-center text-sm font-semibold text-ink-3 underline"
          >
            {t('rider.job.release')}
          </button>
        )}
      </div>

      {next && (
        <div className="sticky bottom-0 border-t border-line bg-surface/95 backdrop-blur-md px-4 pt-3 pb-3">
          {needsPayment && (
            <p className="mb-2 rounded-[var(--radius-md)] bg-warning-soft px-3 py-2 text-center text-sm font-medium text-warning">
              {t('rider.job.payment.needed')}
            </p>
          )}
          {(next === 'picked_up' || next === 'arrived_dropoff') && !needsPayment ? (
            <SwipeSlider
              label={t(`rider.job.actions.${next}`)}
              onConfirm={() => step.mutate(next)}
              loading={step.isPending}
              disabled={needsPayment}
            />
          ) : (
            <Button
              size="lg"
              block
              onClick={() => step.mutate(next)}
              loading={step.isPending}
              disabled={needsPayment}
            >
              {t(`rider.job.actions.${next}`)}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Rider confirms how the fare was paid to them. Safe to tap twice: the server records it once. */
function PaymentPanel({ job, onDone }: { job: RiderJob; onDone: () => void }) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<PaymentMethod>(job.preferredPaymentMethod);
  const [reference, setReference] = useState('');
  const record = useMutation({
    mutationFn: () =>
      api(`/rider/jobs/${job.id}/payment`, {
        method: 'POST',
        body: { method, reference: reference.trim() || undefined },
      }),
    onSettled: onDone,
  });
  return (
    <Panel className="flex flex-col gap-4 p-4">
      <div>
        <p className="font-semibold">{t('rider.job.payment.title')}</p>
        <p className="text-sm text-ink-2">
          {t('rider.job.collectCash', {
            amount: job.fare,
            method: t(`booking.methods.${job.preferredPaymentMethod}`),
          })}
        </p>
      </div>
      <ChoiceGroup
        legend={t('rider.job.payment.method')}
        columns={3}
        value={method}
        onChange={setMethod}
        choices={(['cash', 'telebirr', 'cbe_birr'] as const).map((m) => ({
          value: m,
          label: t(`booking.methods.${m}`),
        }))}
      />
      {method !== 'cash' && (
        <TextField
          label={t('rider.job.payment.reference')}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          maxLength={60}
          autoCapitalize="characters"
        />
      )}
      {record.isError && <Notice tone="danger">{(record.error as Error).message}</Notice>}
      <Button size="lg" block onClick={() => record.mutate()} loading={record.isPending}>
        {t('rider.job.payment.received')}
      </Button>
    </Panel>
  );
}

/** Whole minutes since `since` (the journey timer), refreshed every 15 s. */
function useElapsedMinutes(since: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [since]);
  return since ? Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000)) : 0;
}
