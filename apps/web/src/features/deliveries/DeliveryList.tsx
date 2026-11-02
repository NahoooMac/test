import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { DeliverySummary } from '@dp/shared';
import { api } from '../../lib/api.ts';
import { pollEvery } from '../../lib/live.ts';
import {
  Button,
  EmptyState,
  ErrorState,
  ParcelIcon3D,
  Segmented,
  Skeleton,
  cn,
  type Tone,
} from '../../ui/index.ts';
import { isOpen, STATUS_TONE } from './status.ts';

export function useDeliveries() {
  return useQuery({
    queryKey: ['deliveries'],
    queryFn: () => api<DeliverySummary[]>('/deliveries'),
    refetchInterval: (q) =>
      q.state.data?.some((d) => isOpen(d.status)) ? pollEvery(30_000, 120_000) : false,
  });
}

export const STATUS_TEXT: Record<Tone, string> = {
  neutral: 'text-ink-2',
  accent: 'text-accent',
  info: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

export function DeliveryCard({ d }: { d: DeliverySummary }) {
  const { t, i18n } = useTranslation();
  const when = new Date(d.createdAt).toLocaleString(i18n.language === 'am' ? 'am-ET' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <Link
      to={`/deliveries/${d.id}`}
      className="flex items-center gap-3.5 rounded-[var(--radius-xl)] bg-surface p-3.5 shadow-[var(--shadow-sm)] ring-1 ring-line/70 transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:shadow-[var(--shadow-md)] active:scale-[0.99]"
    >
      <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent-soft/70">
        <ParcelIcon3D className="size-9" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-[15px] font-bold leading-snug', STATUS_TEXT[STATUS_TONE[d.status]])}>
          {t(`delivery.statuses.${d.status}`)}
        </p>
        <p className="truncate text-sm font-medium text-ink">
          {d.pickup.address} → {d.dropoff.address}
        </p>
        <p className="mt-0.5 text-xs text-ink-3 tabular">
          {when} · {d.fare} ETB · #{d.code}
        </p>
      </div>
      <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}

type Filter = 'all' | 'active' | 'completed';

export function DeliveryList() {
  const { t } = useTranslation();
  const list = useDeliveries();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const all = list.data ?? [];
  const active = all.filter((d) => isOpen(d.status));
  const completed = all.filter((d) => d.status === 'delivered');
  const shown = filter === 'active' ? active : filter === 'completed' ? completed : all;

  return (
    <div className="flex flex-col gap-4 px-4 pt-6 pb-6">
      <h1 className="text-center text-xl font-bold tracking-tight">{t('delivery.myOrders')}</h1>
      {all.length > 0 && (
        <Segmented
          label={t('delivery.myOrders')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('delivery.filters.all') },
            { value: 'active', label: t('delivery.filters.active'), count: active.length },
            { value: 'completed', label: t('delivery.filters.completed') },
          ]}
        />
      )}
      {list.isPending && [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
      {list.isError && (
        <ErrorState
          title={t('errors.genericTitle')}
          action={<Button onClick={() => list.refetch()}>{t('common.retry')}</Button>}
        />
      )}
      {list.data?.length === 0 && (
        <EmptyState
          icon={<ParcelIcon3D className="size-10" />}
          title={t('delivery.empty')}
          body={t('delivery.emptyBody')}
          action={<Button onClick={() => navigate('/send')}>{t('delivery.send')}</Button>}
        />
      )}
      {all.length > 0 && shown.length === 0 && (
        <p className="py-10 text-center text-sm text-ink-3">{t('delivery.filterEmpty')}</p>
      )}
      <div className="flex flex-col gap-2.5">
        {shown.map((d) => (
          <DeliveryCard key={d.id} d={d} />
        ))}
      </div>
    </div>
  );
}
