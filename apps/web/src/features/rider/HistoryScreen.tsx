import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Pause, Play, Star } from 'lucide-react';
import type { DeliveryHistoryDetail } from '@dp/shared';
import { MapView, type MapMarker } from '../../map/MapView.tsx';
import { Badge, Button, EmptyState, ErrorState, Panel, Segmented, Skeleton, type Tone } from '../../ui/index.ts';
import { useHistory, useHistoryDetail, useRiderCopy } from './features.ts';

const when = (iso: string, lang: string) =>
  new Date(iso).toLocaleString(lang === 'am' ? 'am-ET' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
const toneFor = (status: string): Tone =>
  status === 'delivered' ? 'success' : status === 'cancelled' ? 'neutral' : 'warning';

export function HistoryScreen() {
  const c = useRiderCopy();
  const { t, i18n } = useTranslation();
  const [group, setGroup] = useState<'all' | 'completed' | 'unsuccessful'>('all');
  const list = useHistory(group);

  return (
    <div className="flex flex-col gap-4 px-4 pt-6 pb-6">
      <h1 className="text-center text-xl font-bold tracking-tight">{c.history.title}</h1>
      <Segmented
        label={c.history.title}
        value={group}
        onChange={setGroup}
        options={[
          { value: 'all', label: c.history.filters.all },
          { value: 'completed', label: c.history.filters.completed },
          { value: 'unsuccessful', label: c.history.filters.unsuccessful },
        ]}
      />
      {list.isPending && <Skeleton className="h-40 w-full" />}
      {list.isError && <ErrorState title={t('errors.genericTitle')} body={list.error.message} />}
      {list.data && list.data.length === 0 && <EmptyState title={c.history.title} body={c.history.empty} />}
      {list.data && list.data.length > 0 && (
        <Panel className="divide-y divide-line">
          {list.data.map((d) => (
            <Link key={d.id} to={`/rider/history/${d.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">#{d.code}</span>
                  <Badge tone={toneFor(d.status)}>{t(`delivery.statuses.${d.status}`)}</Badge>
                </div>
                <p className="truncate text-sm text-ink-2">
                  {d.pickupAddress} → {d.dropoffAddress}
                </p>
                <p className="text-xs text-ink-3">{when(d.finishedAt ?? d.createdAt, i18n.language)}</p>
              </div>
              <span className="font-semibold tabular">
                {d.status === 'delivered' ? d.riderEarning : d.cancellationFee !== '0.00' ? d.cancellationFee : '—'}
              </span>
              <ChevronRight className="size-4 text-ink-3" aria-hidden />
            </Link>
          ))}
        </Panel>
      )}
    </div>
  );
}

export function HistoryDetailScreen() {
  const { id = '' } = useParams();
  const c = useRiderCopy();
  const { t } = useTranslation();
  const detail = useHistoryDetail(id);
  return (
    <div className="flex flex-col gap-4 px-4 pt-4 pb-6">
      <Link to="/rider/history" className="inline-flex items-center gap-1 text-sm font-semibold text-accent">
        <ChevronLeft className="size-4" aria-hidden /> {c.history.title}
      </Link>
      {detail.isPending && <Skeleton className="h-72 w-full" />}
      {detail.isError && <ErrorState title={t('errors.genericTitle')} body={detail.error.message} />}
      {detail.data && <HistoryDetailView d={detail.data} />}
    </div>
  );
}

/** Shared by the rider and admin screens: route map with replay, money, timeline. */
export function HistoryDetailView({ d }: { d: DeliveryHistoryDetail }) {
  const c = useRiderCopy();
  const { t, i18n } = useTranslation();
  const route = d.route;
  const [i, setI] = useState(route.length - 1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setI((x) => {
        if (x >= route.length - 1) {
          setPlaying(false);
          return x;
        }
        return x + 1;
      });
    }, Math.max(40, 6000 / Math.max(route.length, 1)));
    return () => clearInterval(timer);
  }, [playing, route.length]);

  const pickup = { lat: d.pickup.lat, lng: d.pickup.lng };
  const dropoff = { lat: d.dropoff.lat, lng: d.dropoff.lng };
  const cur = route[Math.max(0, i)];
  const markers: MapMarker[] = [
    { id: 'p', kind: 'pickup', point: pickup },
    { id: 'd', kind: 'dropoff', point: dropoff },
    ...(cur ? [{ id: 'replay', kind: 'rider' as const, point: { lat: cur.lat, lng: cur.lng } }] : []),
  ];
  const fee = d.status !== 'delivered' && d.cancellationFee !== '0.00';

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight">#{d.code}</h1>
        <Badge tone={toneFor(d.status)}>{t(`delivery.statuses.${d.status}`)}</Badge>
      </div>
      <Panel className="overflow-hidden">
        <MapView
          className="h-72"
          fit
          markers={markers}
          line={[pickup, dropoff]}
          trail={route.length > 1 ? route.slice(0, Math.max(i, 1) + 1) : null}
        />
        <div className="flex flex-col gap-2 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1 w-5 rounded bg-accent" aria-hidden /> {c.history.actualRoute}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 border-t-2 border-dashed border-ink-3" aria-hidden /> {c.history.planned}
            </span>
          </div>
          {route.length < 2 ? (
            <p className="text-ink-3">{c.history.noRoute}</p>
          ) : (
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="secondary"
                icon={playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                onClick={() => {
                  if (!playing && i >= route.length - 1) setI(0);
                  setPlaying(!playing);
                }}
              >
                {playing ? c.history.pause : c.history.replay}
              </Button>
              <input
                type="range"
                min={0}
                max={route.length - 1}
                value={i}
                onChange={(e) => {
                  setPlaying(false);
                  setI(Number(e.target.value));
                }}
                aria-label={c.history.replay}
                className="flex-1 accent-[var(--c-accent)]"
              />
            </div>
          )}
          {cur && route.length > 1 && (
            <p className="text-xs text-ink-3">
              {c.history.stages[cur.stage]} · {when(cur.at, i18n.language)}
            </p>
          )}
        </div>
      </Panel>

      <Panel className="p-4">
        <p className="text-sm">
          <span className="font-semibold">{d.pickup.address}</span> → <span className="font-semibold">{d.dropoff.address}</span>
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-ink-3">{c.history.distance}</dt>
            <dd className="font-semibold">
              {d.recordedKm != null ? `${d.recordedKm} km ${c.history.recorded} · ` : ''}
              {d.distanceKm} km {c.history.plannedKm}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">{c.history.duration}</dt>
            <dd className="font-semibold">{d.durationMin != null ? `${d.durationMin} min` : '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-3">{c.history.fare}</dt>
            <dd className="font-semibold tabular">{d.fare} ETB</dd>
          </div>
          <div>
            <dt className="text-ink-3">{c.history.commission}</dt>
            <dd className="font-semibold tabular">{d.commissionDeducted ? `${d.commissionDeducted} ETB` : '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-3">{fee ? c.history.fee : c.history.net}</dt>
            <dd className="font-semibold tabular text-accent">
              {fee ? d.cancellationFee : d.status === 'delivered' ? d.riderEarning : '0.00'} ETB
            </dd>
          </div>
          {d.rating && (
            <div>
              <dt className="text-ink-3">{c.history.rating}</dt>
              <dd className="inline-flex items-center gap-1 font-semibold">
                <Star className="size-4 fill-current text-warning" aria-hidden /> {d.rating.stars}
              </dd>
            </div>
          )}
        </dl>
        {d.cancelReason && (
          <p className="mt-3 text-sm">
            <span className="text-ink-3">{c.history.reason}: </span>
            {d.cancelReason}
          </p>
        )}
      </Panel>

      <Panel className="p-4">
        <h2 className="font-semibold">{c.history.timeline}</h2>
        <ol className="mt-2 flex flex-col gap-2 text-sm">
          {d.timeline.map((e, k) => (
            <li key={k} className="flex justify-between gap-3">
              <span>{t(`delivery.statuses.${e.status}`)}</span>
              <span className="text-ink-3 tabular">{when(e.at, i18n.language)}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </>
  );
}
