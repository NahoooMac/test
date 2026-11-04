import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { subCityName, type PublicTracking } from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import { useTheme } from '../../lib/theme.ts';
import { MapView } from '../../map/MapView.tsx';
import { Button, ErrorState, Panel, Skeleton, Timeline } from '../../ui/index.ts';
import { LanguageToggle } from '../auth/LanguageToggle.tsx';
import { isOpen, stageIndex } from '../deliveries/status.ts';
import { TrackingSheet } from '../deliveries/TrackingSheet.tsx';
import { FinalPriceCard } from '../deliveries/FinalPriceCard.tsx';
import { Wordmark } from '../../surfaces/Wordmark.tsx';

/** Public page for the receiver: no sign-in, live updates, no sender/receiver phone numbers. */
export default function TrackPage() {
  useTheme();
  const { t, i18n } = useTranslation();
  const { code = '' } = useParams();
  const queryClient = useQueryClient();
  const key = ['track', code.toUpperCase()];

  const track = useQuery({
    queryKey: key,
    queryFn: () => api<PublicTracking>(`/track/${encodeURIComponent(code)}`),
    retry: (n, err) => !(err instanceof ApiRequestError && err.status < 500) && n < 2,
    refetchInterval: (q) => (q.state.data && isOpen(q.state.data.status) ? 60_000 : false),
  });

  // Live stream for this one code: positions are patched in place, status changes refetch.
  const open = !!track.data && isOpen(track.data.status);
  useEffect(() => {
    if (!open || typeof EventSource === 'undefined') return;
    const source = new EventSource(`/api/track/${encodeURIComponent(code)}/events`);
    source.addEventListener('location', ((ev: MessageEvent<string>) => {
      const p = JSON.parse(ev.data) as { lat: number; lng: number; at: string };
      queryClient.setQueryData<PublicTracking>(key, (old) =>
        old ? { ...old, riderLocation: { lat: p.lat, lng: p.lng, at: p.at } } : old,
      );
    }) as EventListener);
    source.addEventListener(
      'delivery',
      () => void queryClient.invalidateQueries({ queryKey: key }),
    );
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, code]);

  const header = (
    <header className="flex items-center justify-between px-4 pt-4 pb-3">
      <Wordmark />
      <LanguageToggle />
    </header>
  );

  if (track.isPending) {
    return (
      <main className="mx-auto max-w-md">
        {header}
        <div className="flex flex-col gap-3 px-4">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      </main>
    );
  }
  if (track.isError) {
    const missing = track.error instanceof ApiRequestError && track.error.status === 404;
    return (
      <main className="mx-auto max-w-md">
        {header}
        <ErrorState
          title={missing ? t('delivery.notFound') : t('errors.genericTitle')}
          action={!missing && <Button onClick={() => track.refetch()}>{t('common.retry')}</Button>}
        />
      </main>
    );
  }

  const d = track.data;
  const stage = stageIndex(d.status);
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(i18n.language === 'am' ? 'am-ET' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col pb-6">
      {header}
      <div className="relative">
      <MapView
        className="h-[50vh] min-h-[300px]"
        markers={[
          { id: 'p', point: d.pickup, kind: 'pickup' },
          { id: 'd', point: d.dropoff, kind: 'dropoff' },
          ...(d.riderLocation
            ? [{ id: 'r', point: d.riderLocation, kind: 'rider' as const, vehicleType: d.vehicleType }]
            : []),
        ]}
        line={[d.pickup, d.dropoff]}
        labels={{ pickup: t('booking.pickup'), dropoff: t('booking.dropoff') }}
        fit
      />
        {isOpen(d.status) && (
          <div className="pointer-events-none absolute top-4 right-4 flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-bold shadow-[var(--shadow-md)] tabular">
            <Clock className="size-3.5 text-accent" aria-hidden />
            ~{d.etaMin} min
          </div>
        )}
      </div>
      <TrackingSheet
        status={t(`delivery.statuses.${d.status}`)}
        subtitle={`${t('delivery.tripMin', { min: d.etaMin })} · #${d.code}`}
        vehicleType={d.vehicleType}
        stage={stage}
        rider={
          d.rider
            ? { name: d.rider.firstName ?? '—', plate: d.rider.plate, phone: d.rider.phone ?? null }
            : null
        }
        pickup={{ title: d.pickup.address, sub: subCityName(d.pickup.subCity, i18n.language) }}
        dropoff={{ title: d.dropoff.address, sub: subCityName(d.dropoff.subCity, i18n.language) }}
      />
      <div className="flex flex-col gap-4 px-4 pt-5">
        {d.payment && (
          <FinalPriceCard
            code={d.code}
            payer={d.payment.payer}
            finalFare={d.payment.finalFare}
            status={d.payment.status}
            delivered={d.status === 'delivered'}
          />
        )}
        <section>
          <h2 className="mb-3 text-base font-semibold">{t('delivery.history')}</h2>
          <Panel className="p-4">
            <Timeline
              items={d.timeline.map((e, i) => ({
                id: `${e.status}-${i}`,
                title: t(`delivery.statuses.${e.status}`),
                time: time(e.at),
                state: i === d.timeline.length - 1 && isOpen(d.status) ? 'current' : 'done',
              }))}
            />
          </Panel>
        </section>
      </div>
    </main>
  );
}
