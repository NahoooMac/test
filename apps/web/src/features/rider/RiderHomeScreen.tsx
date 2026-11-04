import { LowWalletBanner } from './WalletScreen.tsx';
import { useWallet } from './features.ts';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Clock, LocateFixed, MapPinOff, Radio, TrendingUp, Wallet } from 'lucide-react';
import { ADDIS_CENTER, type RiderProfile } from '@dp/shared';
import { api } from '../../lib/api.ts';
import {
  Button,
  EmptyState,
  ErrorState,
  Notice,
  Panel,
  Segmented,
  Skeleton,
  SwipeSlider,
  cn,
} from '../../ui/index.ts';
import { MapView } from '../../map/MapView.tsx';
import { ActiveJob } from './ActiveJob.tsx';
import { ApplyForm } from './ApplyForm.tsx';
import { KycFlow } from './kyc/KycFlow.tsx';
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
  const gps = useLocationSharing(online || onJob, home.data?.job?.id);
  useWakeLock(online || onJob);
  const [recenter, setRecenter] = useState(0);
  const wallet = useWallet();

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

  // A delivery already under way is always finished first.
  if (home.data.job) return <ActiveJob job={home.data.job} position={gps.position} />;

  // Identity verification comes before anything else (the server enforces it too).
  if (profile.kycStatus !== 'approved' && profile.approvalStatus !== 'suspended') {
    return <KycFlow />;
  }

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

  const here = gps.position;

  return (
    // Exactly one screen above the tab bar: the map takes what the sheet leaves (about half), so the
    // swipe control is never pushed under the tab bar.
    <div className="relative flex h-[calc(100dvh-5.5rem-env(safe-area-inset-bottom))] min-h-[560px] flex-col">
      {home.data.offer && <OfferCard offer={home.data.offer} />}

      {/* Map: the top part of the screen, following the rider. */}
      <div className="relative min-h-[200px] flex-1">
        <MapView
          className="absolute inset-0"
          center={here ?? ADDIS_CENTER}
          zoom={here ? 16 : 13}
          recenterKey={recenter}
          markers={
            here
              ? [
                  {
                    id: 'me',
                    point: here,
                    kind: 'rider',
                    heading: gps.heading,
                    vehicleType: profile.vehicleType,
                    radar: online,
                  },
                ]
              : []
          }
          zoomControls={false}
          scrollZoom
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-4">
          <span
            className={cn(
              'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold shadow-[var(--shadow-md)]',
              online ? 'bg-navy text-navy-ink' : 'bg-surface text-ink',
            )}
          >
            <span className="relative flex size-2.5">
              {online && (
                <span className="absolute inset-0 animate-ping rounded-full bg-success/70" aria-hidden />
              )}
              <span
                className={cn('relative size-2.5 rounded-full', online ? 'bg-success' : 'bg-line-strong')}
              />
            </span>
            {online ? t('rider.onlineShort') : t('rider.offlineShort')}
            {profile.plateNumber && (
              <span className="font-semibold opacity-60">· {profile.plateNumber}</span>
            )}
          </span>
        </div>

        <Link
          to="/rider/wallet"
          aria-label={t('nav.earnings')}
          className="absolute bottom-10 left-4 flex size-14 items-center justify-center rounded-full bg-navy text-navy-ink shadow-[var(--shadow-lg)] active:scale-95"
        >
          <Wallet className="size-6" aria-hidden />
        </Link>
        <button
          type="button"
          onClick={() => setRecenter((n) => n + 1)}
          aria-label={t('rider.nav.recenter')}
          className="absolute right-4 bottom-10 flex size-14 items-center justify-center rounded-full bg-navy text-navy-ink shadow-[var(--shadow-lg)] active:scale-95"
        >
          <LocateFixed className="size-6" aria-hidden />
        </button>
      </div>

      {/* Sheet: today's numbers, status, and the online switch. */}
      <div className="relative z-10 -mt-6 flex shrink-0 flex-col gap-3 rounded-t-[28px] bg-canvas px-4 pt-3 pb-3 shadow-[0_-10px_28px_rgba(15,23,42,0.10)]">
        <span className="mx-auto h-1.5 w-10 rounded-full bg-line-strong" aria-hidden />
        <LowWalletBanner wallet={wallet.data} />
        <TodayStats />

        {online && (
          <Panel className="flex items-center gap-3 p-4">
            <span className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft">
              <span className="absolute inset-0 animate-ping rounded-full bg-accent/20" aria-hidden />
              <Radio className="relative size-5 text-accent" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">{t('rider.finding')}</p>
              <GpsStatus state={gps.state} />
            </div>
          </Panel>
        )}

        <div className="flex flex-col gap-2 pt-1">
          {toggle.isError && <Notice tone="danger">{toggle.error.message}</Notice>}
          <SwipeSlider
            key={online ? 'on' : 'off'}
            label={online ? t('rider.swipeOffline') : t('rider.swipeOnline')}
            tone={online ? 'quiet' : 'accent'}
            loading={toggle.isPending}
            onConfirm={() => toggle.mutate(!online)}
          />
          {!online && <p className="text-center text-xs text-ink-3">{t('rider.offlineBody')}</p>}
        </div>
      </div>
    </div>
  );
}

/** Two numbers at a glance, like the top of a ride-hailing driver app. Tap for details. */
function TodayStats() {
  const { t } = useTranslation();
  const { jobs, todayCount, todayTotal } = useRiderEarnings();
  return (
    <Link
      to="/rider/earnings"
      className="grid grid-cols-2 divide-x divide-white/10 rounded-[var(--radius-xl)] bg-navy py-4 text-navy-ink shadow-[var(--shadow-md)]"
    >
      <span className="flex items-center gap-3 px-4">
        <TrendingUp className="size-7 shrink-0 text-accent-2" aria-hidden />
        <span className="min-w-0">
          <span className="block text-sm text-navy-ink/70">{t('rider.earnings.todayEarnings')}</span>
          <span className="block text-xl font-bold tabular">
            {jobs.isPending ? '—' : todayTotal} <span className="text-sm font-semibold">ETB</span>
          </span>
        </span>
      </span>
      <span className="flex items-center gap-3 px-4">
        <Wallet className="size-7 shrink-0 text-accent-2" aria-hidden />
        <span className="min-w-0">
          <span className="block text-sm text-navy-ink/70">{t('rider.earnings.deliveries')}</span>
          <span className="block text-xl font-bold tabular">{jobs.isPending ? '—' : todayCount}</span>
        </span>
      </span>
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
