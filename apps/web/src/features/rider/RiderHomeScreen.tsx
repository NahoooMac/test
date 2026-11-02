import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Clock,
  History,
  MapPinOff,
  Radio,
  TrendingUp,
  UserRound,
  Wallet,
} from 'lucide-react';
import type { RiderProfile } from '@dp/shared';
import { api } from '../../lib/api.ts';
import {
  Button,
  EmptyState,
  ErrorState,
  Notice,
  Panel,
  PlateBadge,
  Segmented,
  Skeleton,
  cn,
} from '../../ui/index.ts';
import { VehicleHero } from '../../map/VehicleHero.tsx';
import { ActiveJob } from './ActiveJob.tsx';
import { ApplyForm } from './ApplyForm.tsx';
import { OfferCard } from './OfferCard.tsx';
import {
  riderHomeKey,
  useLocationSharing,
  useRiderHome,
  useWakeLock,
  type GpsState,
} from './hooks.ts';

interface RiderJobRow {
  id: string;
  code: string;
  status: string;
  riderEarning: string;
  cancellationFee: string;
  updatedAt: string;
}

interface RiderLedger {
  balance: string;
  entries: Array<{
    id: string;
    type: 'commission' | 'settlement' | 'adjustment';
    amount: string;
    deliveryCode: string | null;
    createdAt: string;
  }>;
}

const DONE = ['delivered', 'returned'];

function useRiderEarnings() {
  const jobs = useQuery({
    queryKey: ['rider', 'jobs'],
    queryFn: () => api<RiderJobRow[]>('/rider/jobs'),
  });
  const ledger = useQuery({
    queryKey: ['rider', 'ledger'],
    queryFn: () => api<RiderLedger>('/rider/ledger'),
  });
  const today = new Date().toDateString();
  const doneToday = (jobs.data ?? []).filter(
    (j) => DONE.includes(j.status) && new Date(j.updatedAt).toDateString() === today,
  );
  const todayCents = doneToday.reduce((s, j) => s + Math.round(Number(j.riderEarning) * 100), 0);
  return { jobs, ledger, todayCount: doneToday.length, todayTotal: (todayCents / 100).toFixed(2) };
}

function EarningsCard({ withOwed = true }: { withOwed?: boolean }) {
  const { t } = useTranslation();
  const { jobs, ledger, todayCount, todayTotal } = useRiderEarnings();
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-2xl)] bg-navy p-5 text-navy-ink shadow-[var(--shadow-xl)]">
      <div className="pointer-events-none absolute -top-14 -right-14 size-44 rounded-full bg-accent/30 blur-3xl" aria-hidden />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-sm text-navy-ink/70">{t('rider.earnings.todayEarnings')}</p>
          {jobs.isPending ? (
            <Skeleton className="mt-2 h-10 w-40 bg-white/10" />
          ) : (
            <p className="mt-1 text-[38px] leading-none font-bold tracking-tight tabular">
              {todayTotal} <span className="text-lg font-semibold text-navy-ink/80">ETB</span>
            </p>
          )}
        </div>
        <span className="flex size-10 items-center justify-center rounded-[var(--radius-md)] bg-white/10 text-accent-2">
          <TrendingUp className="size-5" aria-hidden />
        </span>
      </div>
      <div
        className={cn(
          'relative mt-5 grid divide-x divide-white/10 border-t border-white/10 pt-4 text-center',
          withOwed ? 'grid-cols-2' : 'grid-cols-1',
        )}
      >
        <div>
          <p className="text-xl font-bold tabular">{jobs.isPending ? '—' : todayCount}</p>
          <p className="text-xs text-navy-ink/60">{t('rider.earnings.deliveries')}</p>
        </div>
        {withOwed && (
          <div>
            <p className="text-xl font-bold tabular">
              {ledger.data ? ledger.data.balance : '—'}{' '}
              <span className="text-xs font-semibold text-navy-ink/60">ETB</span>
            </p>
            <p className="text-xs text-navy-ink/60">{t('rider.earnings.owedShort')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function RiderHomeScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const home = useRiderHome();
  const profile = home.data?.profile ?? null;
  const online = !!profile?.isOnline;
  const onJob = !!home.data?.job;
  const gps = useLocationSharing(online || onJob);
  useWakeLock(online || onJob);

  const toggle = useMutation({
    mutationFn: (next: boolean) =>
      api<RiderProfile>('/rider/status', { method: 'POST', body: { online: next } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: riderHomeKey }),
  });

  if (home.isPending) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-14 w-2/3" />
        <Skeleton className="h-40 w-full rounded-[var(--radius-2xl)]" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (home.isError) {
    return (
      <ErrorState
        title={t('errors.genericTitle')}
        body={home.error.message}
        action={<Button onClick={() => home.refetch()}>{t('common.retry')}</Button>}
      />
    );
  }
  if (!profile) return <ApplyForm />;

  if (profile.approvalStatus !== 'approved') {
    const key = profile.approvalStatus === 'pending' ? 'pending' : profile.approvalStatus;
    return (
      <EmptyState
        className="pt-20"
        icon={<Clock className="size-6" aria-hidden />}
        title={t(`rider.${key}.title`)}
        body={
          profile.approvalStatus === 'pending'
            ? t('rider.pending.body')
            : (profile.rejectionReason ?? undefined)
        }
      />
    );
  }

  if (home.data.job) return <ActiveJob job={home.data.job} position={gps.position} />;

  const initials = (profile.fullName ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

  return (
    <div className="flex flex-col gap-5 px-4 pt-5 pb-6">
      {home.data.offer && <OfferCard offer={home.data.offer} />}

      <header className="flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-2 to-accent text-[15px] font-bold text-white shadow-[var(--shadow-md)] ring-2 ring-surface">
          {initials || <UserRound className="size-5" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-bold">{profile.fullName}</p>
          <p className="flex items-center gap-1.5 text-sm text-ink-3">
            <span
              className={cn('size-2 rounded-full', online ? 'bg-success' : 'bg-line-strong')}
              aria-hidden
            />
            {online ? t('rider.onlineShort') : t('rider.offlineShort')}
          </p>
        </div>
        {profile.plateNumber && <PlateBadge>{profile.plateNumber}</PlateBadge>}
      </header>

      <EarningsCard />

      <button
        type="button"
        role="switch"
        aria-checked={online}
        disabled={toggle.isPending}
        onClick={() => toggle.mutate(!online)}
        className={cn(
          'flex h-16 items-center gap-3 rounded-[var(--radius-xl)] px-5 text-left text-base font-bold',
          'transition-all duration-[var(--dur-normal)] ease-[var(--ease-out)] active:scale-[0.98] disabled:opacity-60',
          online
            ? 'bg-surface text-ink shadow-[var(--shadow-sm)] ring-1 ring-line'
            : 'bg-accent text-white shadow-[0_10px_24px_-8px_rgba(37,99,235,0.7)]',
        )}
      >
        <span className="relative flex size-3">
          {!online && <span className="absolute inset-0 animate-ping rounded-full bg-success/70" aria-hidden />}
          <span className={cn('relative size-3 rounded-full', online ? 'bg-danger' : 'bg-success ring-2 ring-white/60')} />
        </span>
        <span className="flex-1">{online ? t('rider.goOffline') : t('rider.goOnline')}</span>
        <span
          aria-hidden
          className={cn(
            'flex h-8 w-14 items-center rounded-full p-1 transition-all duration-[var(--dur-normal)]',
            online ? 'justify-end bg-success' : 'justify-start bg-white/25',
          )}
        >
          <span className="size-6 rounded-full bg-white shadow-[var(--shadow-sm)]" />
        </span>
      </button>
      {toggle.isError && <Notice tone="danger">{toggle.error.message}</Notice>}

      {online ? (
        <>
          <GpsStatus state={gps.state} />
          <Panel className="relative flex items-center gap-4 overflow-hidden p-4">
            <div className="relative shrink-0">
              <span className="absolute inset-0 animate-ping rounded-full bg-accent/25" aria-hidden />
              <span className="relative flex size-12 items-center justify-center rounded-full bg-accent-soft">
                <Radio className="size-6 text-accent" aria-hidden />
              </span>
            </div>
            <p className="min-w-0 flex-1 text-[15px] font-semibold">{t('rider.waiting')}</p>
            <VehicleHero kind={profile.vehicleType} rider={false} width={140} height={100} className="w-20 shrink-0" />
          </Panel>
        </>
      ) : (
        <Panel className="flex items-center gap-4 p-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-2">
            <Wallet className="size-6 text-ink-3" aria-hidden />
          </span>
          <p className="min-w-0 flex-1 text-sm text-ink-2">{t('rider.offlineBody')}</p>
          <VehicleHero kind={profile.vehicleType} rider={false} width={140} height={100} className="w-20 shrink-0 opacity-80" />
        </Panel>
      )}

      <section>
        <h2 className="mb-3 text-lg font-bold tracking-tight">{t('rider.quickActions')}</h2>
        <div className="grid grid-cols-3 gap-3">
          <QuickAction to="/rider/earnings" icon={Wallet} label={t('nav.earnings')} />
          <QuickAction to="/rider/earnings#history" icon={History} label={t('rider.historyShort')} />
          <QuickAction to="/rider/account" icon={UserRound} label={t('rider.profile')} />
        </div>
      </section>
    </div>
  );
}

function QuickAction({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: typeof Wallet;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] bg-surface py-4 text-sm font-medium shadow-[var(--shadow-sm)] ring-1 ring-line/70 transition-all duration-[var(--dur-fast)] hover:shadow-[var(--shadow-md)] active:scale-[0.97]"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon className="size-5" aria-hidden />
      </span>
      {label}
    </Link>
  );
}

function GpsStatus({ state }: { state: GpsState }) {
  const { t } = useTranslation();
  if (state === 'ok') {
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-success">
        <span className="size-2 rounded-full bg-success" aria-hidden /> {t('rider.gps.ok')}
      </p>
    );
  }
  if (state === 'blocked' || state === 'unsupported') {
    return (
      <Notice tone="danger">
        <span className="flex items-center gap-2">
          <MapPinOff className="size-4 shrink-0" aria-hidden />
          {t(`rider.gps.${state}`)}
        </span>
      </Notice>
    );
  }
  return <p className="text-sm text-ink-3">{t('rider.gps.waiting')}</p>;
}

type JobFilter = 'all' | 'completed' | 'cancelled';

export function RiderEarnings() {
  const { t, i18n } = useTranslation();
  const { jobs, ledger } = useRiderEarnings();
  const [filter, setFilter] = useState<JobFilter>('all');
  const list = jobs.data ?? [];
  const shown = list.filter((j) =>
    filter === 'completed'
      ? DONE.includes(j.status)
      : filter === 'cancelled'
        ? j.status === 'cancelled'
        : true,
  );
  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language === 'am' ? 'am-ET' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="flex flex-col gap-5 px-4 pt-6 pb-6">
      <h1 className="text-center text-xl font-bold tracking-tight">{t('rider.earnings.title')}</h1>
      <EarningsCard withOwed={false} />

      {ledger.data && (
        <Panel className="p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-semibold">{t('rider.earnings.owed')}</p>
            <p className="text-xl font-bold tabular">{ledger.data.balance} ETB</p>
          </div>
          <p className="mt-1 text-sm text-ink-3">{t('rider.earnings.owedHint')}</p>
          {ledger.data.entries.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-accent">
                {t('rider.earnings.history')}
              </summary>
              <ul className="mt-2 divide-y divide-line text-sm">
                {ledger.data.entries.map((e) => (
                  <li key={e.id} className="flex justify-between gap-3 py-2">
                    <span>
                      {t(`rider.earnings.types.${e.type}`)}
                      {e.deliveryCode ? ` · #${e.deliveryCode}` : ''}
                    </span>
                    <span className="tabular">{e.amount}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Panel>
      )}

      <section id="history" className="flex scroll-mt-4 flex-col gap-3">
        <h2 className="text-lg font-bold tracking-tight">{t('rider.earnings.jobHistory')}</h2>
        {list.length > 0 && (
          <Segmented
            label={t('rider.earnings.jobHistory')}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('rider.earnings.filters.all') },
              { value: 'completed', label: t('rider.earnings.filters.completed') },
              { value: 'cancelled', label: t('rider.earnings.filters.cancelled') },
            ]}
          />
        )}
        {jobs.isPending && <Skeleton className="h-24 w-full" />}
        {jobs.data && jobs.data.length === 0 && (
          <EmptyState title={t('rider.earnings.title')} body={t('rider.earnings.empty')} />
        )}
        {shown.length > 0 && (
          <Panel className="divide-y divide-line">
            {shown.map((j) => {
              const done = DONE.includes(j.status);
              const fee = j.status === 'cancelled' && j.cancellationFee !== '0.00';
              const amount = done ? j.riderEarning : fee ? j.cancellationFee : null;
              return (
                <div key={j.id} className="flex items-center gap-3 px-4 py-3.5">
                  <span
                    aria-hidden
                    className={cn(
                      'size-2.5 shrink-0 rounded-full ring-4',
                      done
                        ? 'bg-success ring-success/15'
                        : j.status === 'cancelled' || j.status === 'failed'
                          ? 'bg-danger ring-danger/15'
                          : 'bg-accent ring-accent/15',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{t(`delivery.statuses.${j.status}`)}</p>
                    <p className="text-sm text-ink-3 tabular">
                      #{j.code} · {when(j.updatedAt)}
                    </p>
                  </div>
                  <span
                    className={cn('font-bold tabular', amount ? 'text-success' : 'text-ink-3')}
                  >
                    {amount ? `+${amount} ETB` : '—'}
                  </span>
                </div>
              );
            })}
          </Panel>
        )}
        {list.length > 0 && shown.length === 0 && (
          <p className="py-6 text-center text-sm text-ink-3">{t('delivery.filterEmpty')}</p>
        )}
      </section>
    </div>
  );
}
