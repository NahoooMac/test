import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Volume2, VolumeX } from 'lucide-react';
import { subCityName, type RiderOffer } from '@dp/shared';
import { api } from '../../lib/api.ts';
import { startRingtone } from '../../lib/ringtone.ts';
import { useCountdown } from '../../lib/useCountdown.ts';
import { Badge, Button, Notice, Panel } from '../../ui/index.ts';
import { RouteLines } from '../booking/BookingFlow.tsx';
import { VehicleIcon } from '../deliveries/VehicleIcon.tsx';
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

  // Ring like an incoming call until the rider answers, mutes, or the offer runs out.
  const [muted, setMuted] = useState(false);
  const ringing = !muted && left > 0 && !accept.isPending && !decline.isPending;
  useEffect(() => {
    if (!ringing) return;
    return startRingtone();
  }, [ringing]);

  return (
    <div
      className="fixed inset-0 z-40 mx-auto flex max-w-md flex-col bg-canvas"
      role="alertdialog"
      aria-label={t('rider.offer.title')}
    >
      <div className="h-2 w-full rounded-b-full bg-surface-2" aria-hidden>
        <div
          className="h-full rounded-b-full bg-accent transition-[width] duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pt-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-[26px] font-bold tracking-tight">{t('rider.offer.title')}</h1>
            <Badge tone="accent">
              <VehicleIcon type={d.vehicleType} className="mr-1 inline size-3.5" />
              {t(`booking.vehicles.${d.vehicleType}`)}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? t('rider.offer.unmute') : t('rider.offer.mute')}
              aria-pressed={muted}
              className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-ink-2 hover:text-ink"
            >
              {muted ? <VolumeX className="size-5" aria-hidden /> : <Volume2 className="size-5" aria-hidden />}
            </button>
            <span
              className="rounded-full bg-navy px-3.5 py-1 text-sm font-bold text-navy-ink shadow-[var(--shadow-sm)] tabular"
              aria-live="polite"
            >
              {left}s
            </span>
          </div>
        </div>
        <div className="relative overflow-hidden rounded-[var(--radius-2xl)] bg-navy p-6 text-navy-ink shadow-[var(--shadow-xl)]">
          <div className="pointer-events-none absolute -top-14 -right-14 size-44 rounded-full bg-accent/30 blur-3xl" aria-hidden />
          <p className="relative text-xs font-semibold tracking-wide text-navy-ink/60 uppercase">{t('rider.offer.youEarn')}</p>
          <p className="relative mt-1 text-[48px] font-bold tracking-tight text-accent-2 tabular">
            +{d.riderEarning} <span className="text-lg font-semibold text-navy-ink/80">ETB</span>
          </p>
          <p className="relative mt-2 text-sm text-navy-ink/70 tabular">
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
      <div className="grid grid-cols-[1fr_2fr] gap-3 border-t border-line bg-surface/95 backdrop-blur-md px-5 pt-3 pb-safe">
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
