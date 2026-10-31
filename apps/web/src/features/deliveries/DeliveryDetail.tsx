import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Phone, Share2 } from 'lucide-react';
import { formatPhone, type Delivery } from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import { pollEvery } from '../../lib/live.ts';
import { MapView } from '../../map/MapView.tsx';
import {
  Badge,
  Button,
  ErrorState,
  IconButton,
  Notice,
  Panel,
  PlateBadge,
  Skeleton,
  StatusProgress,
  Timeline,
  useToast,
} from '../../ui/index.ts';
import { Row, RouteLines } from '../booking/BookingFlow.tsx';
import { isOpen, STAGE_KEYS, STATUS_TONE, stageIndex } from './status.ts';

export function DeliveryDetail() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  const delivery = useQuery({
    queryKey: ['delivery', id],
    queryFn: () => api<Delivery>(`/deliveries/${id}`),
    // Live events refresh this instantly; polling is the fallback when the stream is down.
    refetchInterval: (q) =>
      q.state.data && isOpen(q.state.data.status) ? pollEvery(15_000) : false,
  });

  const cancel = useMutation({
    mutationFn: () => api<Delivery>(`/deliveries/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: (d) => {
      queryClient.setQueryData(['delivery', id], d);
      void queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      setConfirming(false);
      toast(t('delivery.cancelled'), 'success');
    },
  });

  const back = (
    <IconButton label={t('common.back')} onClick={() => navigate('/deliveries')}>
      <ChevronLeft className="size-5" aria-hidden />
    </IconButton>
  );

  if (delivery.isPending) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {back}
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (delivery.isError) {
    const notFound = delivery.error instanceof ApiRequestError && delivery.error.status === 404;
    return (
      <div className="p-4">
        {back}
        <ErrorState
          title={notFound ? t('delivery.notFound') : t('errors.genericTitle')}
          action={
            !notFound && <Button onClick={() => delivery.refetch()}>{t('common.retry')}</Button>
          }
        />
      </div>
    );
  }

  const d = delivery.data;
  const stage = stageIndex(d.status);
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(i18n.language === 'am' ? 'am-ET' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="pb-6">
      <div className="relative">
        <MapView
          className="h-60"
          markers={[
            { id: 'p', point: d.pickup, kind: 'pickup' },
            { id: 'd', point: d.dropoff, kind: 'dropoff' },
            ...(d.riderLocation
              ? [{ id: 'r', point: d.riderLocation, kind: 'rider' as const, vehicleType: d.vehicleType }]
              : []),
          ]}
          line={[d.pickup, d.dropoff]}
          fit
          interactive={false}
        />
        <div className="absolute top-4 left-4">{back}</div>
      </div>

      <div className="flex flex-col gap-4 px-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t(`delivery.statuses.${d.status}`)}
            </h1>
            <p className="text-sm text-ink-3 tabular">
              #{d.code} · {d.distanceKm.toFixed(1)} km · ~{d.etaMin} min
            </p>
          </div>
          <Badge tone={STATUS_TONE[d.status]} dot>
            {t(`booking.vehicles.${d.vehicleType}`)}
          </Badge>
        </div>

        {stage >= 0 && (
          <StatusProgress
            label={t('delivery.progress')}
            stages={STAGE_KEYS.map((k) => t(`delivery.stages.${k}`))}
            current={stage}
          />
        )}
        {d.status === 'requested' && <Notice tone="info">{t('delivery.waiting')}</Notice>}
        {isOpen(d.status) && (
          <Button
            variant="secondary"
            icon={<Share2 className="size-4" aria-hidden />}
            onClick={async () => {
              const url = `${location.origin}/t/${d.code}`;
              const text = t('delivery.shareText', { code: d.code });
              try {
                if (navigator.share) await navigator.share({ title: text, text, url });
                else {
                  await navigator.clipboard.writeText(url);
                  toast(t('delivery.linkCopied'), 'success');
                }
              } catch {
                // share sheet dismissed
              }
            }}
          >
            {t('delivery.share')}
          </Button>
        )}

        {d.rider && (
          <Panel className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-ink-3">{t('delivery.rider')}</p>
              <p className="truncate font-semibold">{d.rider.name ?? formatPhone(d.rider.phone)}</p>
            </div>
            {d.rider.plate && <PlateBadge>{d.rider.plate}</PlateBadge>}
            <a
              href={`tel:${d.rider.phone}`}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-4 font-semibold text-accent-ink"
            >
              <Phone className="size-4" aria-hidden />
              {t('delivery.call')}
            </a>
          </Panel>
        )}

        <Panel className="p-4">
          <RouteLines
            from={d.pickup.address}
            fromSub={`${d.pickup.contactName} · ${formatPhone(d.pickup.contactPhone)}`}
            to={d.dropoff.address}
            toSub={`${d.dropoff.contactName} · ${formatPhone(d.dropoff.contactPhone)}`}
          />
        </Panel>

        <Panel className="divide-y divide-line">
          <Row
            label={t('booking.parcelTitle')}
            value={`${d.parcel.description} · ${t(`booking.sizes.${d.parcel.size}`)}`}
          />
          <Row
            label={t('booking.payerTitle')}
            value={`${t(`booking.payers.${d.payer}`)} · ${t(`booking.methods.${d.preferredPaymentMethod}`)}`}
          />
          {d.farePayment?.status === 'collected' && d.farePayment.method ? (
            <Row
              label={t('booking.fare')}
              value={
                <span className="text-success">
                  {t('delivery.paid', { method: t(`booking.methods.${d.farePayment.method}`) })}
                </span>
              }
            />
          ) : null}
          <Row
            label={t('booking.fare')}
            value={<span className="font-bold tabular">{d.fare} ETB</span>}
          />
          {d.status === 'cancelled' && d.cancellationFee !== '0.00' && (
            <Row
              label={t('delivery.statuses.cancelled')}
              value={<span className="tabular">{d.cancellationFee} ETB</span>}
            />
          )}
        </Panel>

        <section>
          <h2 className="mb-3 text-base font-semibold">{t('delivery.history')}</h2>
          <Panel className="p-4">
            <Timeline
              items={d.events.map((e, i) => ({
                id: e.id,
                title: t(`delivery.statuses.${e.toStatus}`),
                time: time(e.at),
                state: i === d.events.length - 1 && isOpen(d.status) ? 'current' : 'done',
              }))}
            />
          </Panel>
        </section>

        {d.cancelFeeNow !== null && (
          <section className="flex flex-col gap-3">
            {confirming ? (
              <>
                <Notice tone={d.cancelFeeNow === '0.00' ? 'info' : 'warning'}>
                  {d.cancelFeeNow === '0.00'
                    ? t('delivery.cancelFree')
                    : t('delivery.cancelFee', { fee: d.cancelFeeNow.replace('.00', '') })}
                </Notice>
                {cancel.isError && <Notice tone="danger">{(cancel.error as Error).message}</Notice>}
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => setConfirming(false)}>
                    {t('delivery.keep')}
                  </Button>
                  <Button
                    variant="danger"
                    loading={cancel.isPending}
                    onClick={() => cancel.mutate()}
                  >
                    {t('delivery.confirmCancel')}
                  </Button>
                </div>
              </>
            ) : (
              <Button variant="danger-soft" block onClick={() => setConfirming(true)}>
                {t('delivery.cancel')}
              </Button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
