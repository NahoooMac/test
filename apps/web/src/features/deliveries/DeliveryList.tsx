import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Package } from 'lucide-react';
import type { DeliverySummary } from '@dp/shared';
import { api } from '../../lib/api.ts';
import { pollEvery } from '../../lib/live.ts';
import { Badge, Button, EmptyState, ErrorState, Skeleton } from '../../ui/index.ts';
import { isOpen, STATUS_TONE } from './status.ts';

export function useDeliveries() {
  return useQuery({
    queryKey: ['deliveries'],
    queryFn: () => api<DeliverySummary[]>('/deliveries'),
    refetchInterval: (q) =>
      q.state.data?.some((d) => isOpen(d.status)) ? pollEvery(30_000, 120_000) : false,
  });
}

export function DeliveryCard({ d }: { d: DeliverySummary }) {
  const { t, i18n } = useTranslation();
  const date = new Date(d.createdAt).toLocaleDateString(
    i18n.language === 'am' ? 'am-ET' : 'en-GB',
    {
      day: 'numeric',
      month: 'short',
    },
  );
  return (
    <Link
      to={`/deliveries/${d.id}`}
      className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-surface-2 hover:shadow-[var(--shadow-sm)]"
    >
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center gap-2">
          <Badge tone={STATUS_TONE[d.status]} dot>
            {t(`delivery.statuses.${d.status}`)}
          </Badge>
          <span className="text-xs text-ink-3 tabular">
            #{d.code} · {date}
          </span>
        </div>
        <p className="truncate text-[15px] font-semibold leading-snug">
          {d.pickup.address} → {d.dropoff.address}
        </p>
        <p className="mt-0.5 text-sm text-ink-3 tabular">
          {d.fare} ETB · {t(`booking.vehicles.${d.vehicleType}`)}
        </p>
      </div>
      <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}

export function DeliveryList() {
  const { t } = useTranslation();
  const list = useDeliveries();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="pt-3 text-[26px] font-bold tracking-tight">{t('delivery.list')}</h1>
      {list.isPending && [0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
      {list.isError && (
        <ErrorState
          title={t('errors.genericTitle')}
          action={<Button onClick={() => list.refetch()}>{t('common.retry')}</Button>}
        />
      )}
      {list.data?.length === 0 && (
        <EmptyState
          icon={<Package className="size-6" aria-hidden />}
          title={t('delivery.empty')}
          body={t('delivery.emptyBody')}
          action={<Button onClick={() => navigate('/send')}>{t('delivery.send')}</Button>}
        />
      )}
      {list.data?.map((d) => (
        <DeliveryCard key={d.id} d={d} />
      ))}
    </div>
  );
}
