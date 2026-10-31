import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Phone } from 'lucide-react';
import { formatPhone, subCityName, type PublicTracking } from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import { useTheme } from '../../lib/theme.ts';
import { MapView } from '../../map/MapView.tsx';
import {
  Badge,
  Button,
  ErrorState,
  Panel,
  PlateBadge,
  Skeleton,
  StatusProgress,
  Timeline,
} from '../../ui/index.ts';
import { LanguageToggle } from '../auth/LanguageToggle.tsx';
import { Row, RouteLines } from '../booking/BookingFlow.tsx';
import { isOpen, STAGE_KEYS, STATUS_TONE, stageIndex } from '../deliveries/status.ts';
import { Wordmark } from '../../surfaces/Wordmark.tsx';

/** Public page for the receiver: no sign-in, live updates, no sender/receiver phone numbers. */
export default function TrackPage() {
  useTheme('system');
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
      <MapView
        className="h-64"
        markers={[
          { id: 'p', point: d.pickup, kind: 'pickup' },
          { id: 'd', point: d.dropoff, kind: 'dropoff' },
          ...(d.riderLocation ? [{ id: 'r', point: d.riderLocation, kind: 'rider' as const }] : []),
        ]}
        line={[d.pickup, d.dropoff]}
        fit
        interactive={false}
      />
      <div className="flex flex-col gap-4 px-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t(`delivery.statuses.${d.status}`)}
            </h1>
            <p className="text-sm text-ink-3 tabular">#{d.code}</p>
          </div>
          <Badge tone={STATUS_TONE[d.status]} dot>
            {t(`booking.vehicles.${d.vehicleType}`)}
          </Badge>
        </div>
        {stage >= 0 && (
          <StatusProgress
            stages={STAGE_KEYS.map((k) => t(`delivery.stages.${k}`))}
            current={stage}
          />
        )}

        {d.rider && (
          <Panel className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-ink-3">{t('delivery.rider')}</p>
              <p className="truncate font-semibold">{d.rider.firstName ?? '—'}</p>
            </div>
            {d.rider.plate && <PlateBadge>{d.rider.plate}</PlateBadge>}
            {d.rider.phone && (
              <a
                href={`tel:${d.rider.phone}`}
                aria-label={`${t('delivery.call')} ${formatPhone(d.rider.phone)}`}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-4 font-semibold text-accent-ink"
              >
                <Phone className="size-4" aria-hidden />
                {t('delivery.call')}
              </a>
            )}
          </Panel>
        )}

        <Panel className="p-4">
          <RouteLines
            from={d.pickup.address}
            fromSub={subCityName(d.pickup.subCity, i18n.language)}
            to={d.dropoff.address}
            toSub={subCityName(d.dropoff.subCity, i18n.language)}
          />
        </Panel>

        {isOpen(d.status) && (
          <Panel>
            <Row
              label={t('delivery.eta')}
              value={`${t(`booking.vehicles.${d.vehicleType}`)} · ~${d.etaMin} min`}
            />
          </Panel>
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
