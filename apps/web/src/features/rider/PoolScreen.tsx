import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Clock, Home, MapPin, Navigation, StickyNote } from 'lucide-react';
import { subCityName, type PoolOffer } from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import { MapView } from '../../map/MapView.tsx';
import { Badge, Button, EmptyState, ErrorState, Notice, Panel, Skeleton, useToast } from '../../ui/index.ts';
import { riderHomeKey } from './hooks.ts';
import { ago, riderKeys, usePool, usePreferences, useRiderCopy } from './features.ts';

/** The delivery offer pool: jobs waiting for a rider that this rider may claim. */
export function PoolScreen() {
  const c = useRiderCopy();
  const { t } = useTranslation();
  const pool = usePool();
  const prefs = usePreferences();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4 px-4 pt-6 pb-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{c.pool.title}</h1>
        <p className="mt-1 text-sm text-ink-3">{c.pool.subtitle}</p>
      </div>
      {pool.data?.blockedReason && (
        <Notice tone={pool.data.blockedReason === 'busy' ? 'info' : 'warning'}>
          {c.pool.blocked[pool.data.blockedReason]}{' '}
          {pool.data.blockedReason === 'wallet' && (
            <Link to="/rider/wallet" className="font-semibold underline">
              {c.wallet.topUp}
            </Link>
          )}
        </Notice>
      )}
      {prefs.data && prefs.data.serviceAreas.length === 0 && (
        <p className="text-sm text-ink-3">
          {c.pool.areasHint}{' '}
          <Link to="/rider/areas" className="font-semibold text-accent">
            {c.pool.setAreas}
          </Link>
        </p>
      )}
      {pool.isPending && [0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
      {pool.isError && (
        <ErrorState
          title={t('errors.genericTitle')}
          body={pool.error.message}
          action={<Button onClick={() => pool.refetch()}>{t('common.retry')}</Button>}
        />
      )}
      {pool.data && pool.data.offers.length === 0 && <EmptyState title={c.pool.title} body={c.pool.empty} />}
      {pool.data?.offers.map((o) => (
        <OfferItem
          key={o.deliveryId}
          offer={o}
          open={open === o.deliveryId}
          onToggle={() => setOpen(open === o.deliveryId ? null : o.deliveryId)}
          canClaim={!pool.data.blockedReason}
        />
      ))}
    </div>
  );
}

function OfferItem({
  offer: o,
  open,
  onToggle,
  canClaim,
}: {
  offer: PoolOffer;
  open: boolean;
  onToggle: () => void;
  canClaim: boolean;
}) {
  const c = useRiderCopy();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const claim = useMutation({
    mutationFn: () => api(`/rider/pool/${o.deliveryId}/claim`, { method: 'POST' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: riderHomeKey });
      navigate('/rider');
    },
    onError: (err) => {
      const gone = err instanceof ApiRequestError && err.code === 'OFFER_GONE';
      toast(gone ? c.pool.gone : err.message, gone ? 'info' : 'danger');
      void qc.invalidateQueries({ queryKey: riderKeys.pool });
    },
  });
  const area = (s: string | null) => subCityName(s, i18n.language);
  const notes = [o.pickup.notes, o.dropoff.notes].filter(Boolean);

  return (
    <Panel className="overflow-hidden">
      <button type="button" onClick={onToggle} aria-expanded={open} className="block w-full p-4 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="accent">{t(`booking.vehicles.${o.vehicleType}`)}</Badge>
              {o.nearHome && (
                <Badge tone="success">
                  <Home className="size-3" aria-hidden /> {c.pool.nearHome}
                </Badge>
              )}
              {o.payer === 'receiver' && <Badge tone="info">{c.pool.receiverPays}</Badge>}
            </div>
            <p className="mt-2 flex items-start gap-2 text-[15px] font-semibold">
              <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full border-2 border-ink" />
              <span className="min-w-0">
                {o.pickup.address}
                {area(o.pickup.subCity) && <span className="font-normal text-ink-3"> · {area(o.pickup.subCity)}</span>}
              </span>
            </p>
            <p className="mt-1 flex items-start gap-2 text-[15px] font-semibold">
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
              <span className="min-w-0">
                {o.dropoff.address}
                {area(o.dropoff.subCity) && <span className="font-normal text-ink-3"> · {area(o.dropoff.subCity)}</span>}
              </span>
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-ink-3">{c.pool.earn}</p>
            <p className="text-xl font-bold tabular text-accent">{o.riderEarning}</p>
            <p className="text-xs text-ink-3">ETB</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
          {o.toPickupKm != null && (
            <span className="inline-flex items-center gap-1">
              <Navigation className="size-3.5" aria-hidden /> {o.toPickupKm} km {c.pool.toPickup}
            </span>
          )}
          <span>
            {o.distanceKm} km {c.pool.trip} · ~{o.etaMin} min
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden /> {c.pool.waiting} {ago(o.availableSince)}
          </span>
        </div>
      </button>
      {open && (
        <div className="border-t border-line">
          <MapView
            className="h-48"
            interactive={false}
            fit
            markers={[
              { id: 'p', kind: 'pickup', point: { lat: o.pickup.lat, lng: o.pickup.lng } },
              { id: 'd', kind: 'dropoff', point: { lat: o.dropoff.lat, lng: o.dropoff.lng } },
            ]}
            line={[
              { lat: o.pickup.lat, lng: o.pickup.lng },
              { lat: o.dropoff.lat, lng: o.dropoff.lng },
            ]}
          />
          <div className="flex flex-col gap-3 p-4">
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-ink-3">{c.pool.fare}</dt>
                <dd className="font-semibold tabular">{o.fare}</dd>
              </div>
              <div>
                <dt className="text-ink-3">{c.pool.commission}</dt>
                <dd className="font-semibold tabular">−{o.commission}</dd>
              </div>
              <div>
                <dt className="text-ink-3">{c.pool.earn}</dt>
                <dd className="font-semibold tabular text-accent">{o.riderEarning}</dd>
              </div>
            </dl>
            <p className="text-sm text-ink-2">
              {o.parcel.description} · {t(`booking.sizes.${o.parcel.size}`)}
            </p>
            {notes.length > 0 && (
              <div className="flex gap-2 rounded-[var(--radius-md)] bg-surface-2 p-3 text-sm">
                <StickyNote className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                <div>
                  <p className="font-semibold">{c.pool.instructions}</p>
                  {notes.map((n, i) => (
                    <p key={i} className="text-ink-2">
                      {n}
                    </p>
                  ))}
                </div>
              </div>
            )}
            <Button block size="lg" loading={claim.isPending} disabled={!canClaim} onClick={() => claim.mutate()}>
              {c.pool.accept}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
