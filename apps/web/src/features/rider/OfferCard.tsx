import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { subCityName, type RiderOffer } from '@dp/shared';
import { api } from '../../lib/api.ts';
import { useCountdown } from '../../lib/useCountdown.ts';
import { Button, Notice, Panel } from '../../ui/index.ts';
import { RouteLines } from '../booking/BookingFlow.tsx';
import { riderHomeKey } from './hooks.ts';

/** Full-screen incoming job: big earning, clear route, 20-second countdown, two large buttons. */
export function OfferCard({ offer }: { offer: RiderOffer }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  // Use the server's remaining seconds, not its clock, so a skewed phone clock cannot cheat.
  const deadline = useMemo(() => Date.now() + offer.secondsLeft * 1000, [offer.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = useCountdown(deadline);
  const refresh = () => queryClient.invalidateQueries({ queryKey: riderHomeKey });

  const accept = useMutation({
    mutationFn: () => api(`/rider/offers/${offer.id}/accept`, { method: 'POST' }),
    onSettled: refresh,
  });
  const decline = useMutation({
    mutationFn: () => api(`/rider/offers/${offer.id}/decline`, { method: 'POST' }),
    onSettled: refresh,
  });
  const d = offer.delivery;
  const pct = Math.max(0, Math.min(100, (left / 20) * 100));

  return (
    <div
      className="fixed inset-0 z-40 mx-auto flex max-w-md flex-col bg-canvas"
      role="alertdialog"
      aria-label={t('rider.offer.title')}
    >
      <div className="h-1.5 w-full bg-surface-2" aria-hidden>
        <div
          className="h-full bg-accent transition-[width] duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pt-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">{t('rider.offer.title')}</h1>
          <span
            className="rounded-full bg-ink px-3 py-1 text-sm font-bold text-canvas tabular"
            aria-live="polite"
          >
            {left}s
          </span>
        </div>
        <div className="rounded-3xl bg-accent-soft p-5 text-accent-soft-ink">
          <p className="text-sm font-semibold">{t('rider.offer.youEarn')}</p>
          <p className="text-5xl font-bold tracking-tight tabular">
            {d.riderEarning} <span className="text-lg font-semibold">ETB</span>
          </p>
          <p className="mt-2 text-sm tabular">
            {t('rider.offer.toPickup', { km: offer.toPickupKm.toFixed(1) })} ·{' '}
            {t('rider.offer.trip', { km: d.distanceKm.toFixed(1) })}
          </p>
        </div>
        <Panel className="p-4">
          <RouteLines
            from={d.pickup.address}
            fromSub={subCityName(d.pickup.subCity, i18n.language)}
            to={d.dropoff.address}
            toSub={subCityName(d.dropoff.subCity, i18n.language)}
          />
        </Panel>
        <p className="text-sm text-ink-2">
          {d.payer === 'sender' ? t('rider.offer.payerSender') : t('rider.offer.payerReceiver')} ·{' '}
          {d.fare} ETB · {d.parcel.description}
        </p>
        {(accept.isError || left === 0) && (
          <Notice tone="warning">{t('rider.offer.expired')}</Notice>
        )}
      </div>
      <div className="grid grid-cols-[1fr_2fr] gap-3 border-t border-line bg-surface px-5 pt-3 pb-safe">
        <Button
          variant="secondary"
          size="lg"
          onClick={() => decline.mutate()}
          loading={decline.isPending}
          disabled={accept.isPending}
        >
          {t('rider.offer.decline')}
        </Button>
        <Button
          size="lg"
          onClick={() => accept.mutate()}
          loading={accept.isPending}
          disabled={left === 0 || decline.isPending}
        >
          {t('rider.offer.accept')}
        </Button>
      </div>
    </div>
  );
}
