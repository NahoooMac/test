import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Navigation, Phone, PhoneOff } from 'lucide-react';
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
import { Badge, Button, ChoiceGroup, Notice, Panel, TextField, Timeline } from '../../ui/index.ts';
import { STATUS_TONE } from '../deliveries/status.ts';
import { riderHomeKey } from './hooks.ts';

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

/** Yandex Maps route link; opens the Yandex Maps / Navigator app on Android when installed. */
const navigateUrl = (p: { lat: number; lng: number }) =>
  `https://yandex.com/maps/?rtext=~${p.lat},${p.lng}&rtt=auto`;

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

  const step = useMutation({
    mutationFn: (to: string) =>
      api(`/rider/jobs/${job.id}/step`, { method: 'POST', body: { to, ...position } }),
    onSettled: refresh,
  });
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
  // A failed delivery's fare is still due; it's collected when the parcel goes back to the sender.
  const collectHere =
    (job.payer === 'sender' && job.status === 'arrived_pickup') ||
    (job.payer === 'receiver' && job.status === 'arrived_dropoff') ||
    job.status === 'returning';
  // The server refuses "delivered" until the fare is recorded; mirror that so the rider knows why.
  const needsPayment = next === 'delivered' && !job.farePayment;
  const error = step.error ?? release.error ?? fail.error ?? logCall.error;
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(i18n.language === 'am' ? 'am-ET' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });

  const markers: MapMarker[] = [
    { id: 'p', point: job.pickup, kind: 'pickup' },
    { id: 'd', point: job.dropoff, kind: 'dropoff' },
    ...(position ? [{ id: 'me', point: position, kind: 'rider' as const }] : []),
  ];

  return (
    <div className="flex flex-1 flex-col">
      <MapView
        className="h-56"
        markers={markers}
        line={[job.pickup, job.dropoff]}
        fit
        interactive={false}
      />
      <div className="flex flex-1 flex-col gap-4 px-4 pt-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t(HEADLINE[job.status] ?? `delivery.statuses.${job.status}`)}
            </h1>
            <p className="text-sm text-ink-3 tabular">
              #{job.code} · {job.distanceKm.toFixed(1)} km · {job.riderEarning} ETB
            </p>
          </div>
          <Badge tone={STATUS_TONE[job.status]} dot>
            {t(`booking.vehicles.${job.vehicleType}`)}
          </Badge>
        </div>

        <Panel className="p-4">
          <p className="text-xs text-ink-3">{stopLabel}</p>
          <p className="text-lg font-semibold">{stop.address}</p>
          {stop.subCity && (
            <p className="text-sm text-ink-3">{subCityName(stop.subCity, i18n.language)}</p>
          )}
          <p className="mt-2 text-[15px] font-medium">
            {stop.contactName} · <span className="tabular">{formatPhone(stop.contactPhone)}</span>
          </p>
          {stop.notes && <p className="mt-1 text-sm text-ink-2">“{stop.notes}”</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <a
              href={`tel:${stop.contactPhone}`}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface font-semibold"
            >
              <Phone className="size-4" aria-hidden />
              {t('rider.job.call')}
            </a>
            <a
              href={navigateUrl(stop)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface font-semibold"
            >
              <Navigation className="size-4" aria-hidden />
              {t('rider.job.navigate')}
            </a>
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

        {job.status === 'arrived_dropoff' && (
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
        <div className="sticky bottom-0 border-t border-line bg-surface px-4 pt-3 pb-3">
          {needsPayment && (
            <p className="mb-2 text-center text-sm text-ink-3">{t('rider.job.payment.needed')}</p>
          )}
          <Button
            size="lg"
            block
            onClick={() => step.mutate(next)}
            loading={step.isPending}
            disabled={needsPayment}
          >
            {t(`rider.job.actions.${next}`)}
          </Button>
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
