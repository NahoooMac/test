import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Clock, MapPinOff, Radio, Wallet } from 'lucide-react';
import type { RiderProfile } from '@dp/shared';
import { api } from '../../lib/api.ts';
import {
  Button,
  EmptyState,
  ErrorState,
  Notice,
  Panel,
  PlateBadge,
  Skeleton,
  cn,
} from '../../ui/index.ts';
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
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
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

  return (
    <div className="flex flex-col gap-5 p-4">
      {home.data.offer && <OfferCard offer={home.data.offer} />}
      <div className="flex items-center justify-between pt-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-ink-3">{profile.fullName}</p>
          <h1 className="text-[26px] font-bold tracking-tight">
            {online ? t('rider.online') : t('rider.offline')}
          </h1>
        </div>
        {profile.plateNumber && <PlateBadge>{profile.plateNumber}</PlateBadge>}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={online}
        disabled={toggle.isPending}
        onClick={() => toggle.mutate(!online)}
        className={cn(
          'flex h-20 items-center justify-between rounded-[var(--radius-xl)] px-6 text-left text-lg font-bold',
          'shadow-[var(--shadow-md)] transition-all duration-[var(--dur-normal)] ease-[var(--ease-out)]',
          'active:scale-[0.98] disabled:opacity-60',
          online ? 'bg-accent text-accent-ink' : 'bg-ink text-canvas',
        )}
      >
        <span>{online ? t('rider.goOffline') : t('rider.goOnline')}</span>
        <span
          aria-hidden
          className={cn(
            'flex h-9 w-16 items-center rounded-full p-1 transition-all duration-[var(--dur-normal)]',
            online ? 'justify-end bg-black/20' : 'justify-start bg-white/20',
          )}
        >
          <span className="size-7 rounded-full bg-white shadow-[var(--shadow-sm)] transition-all duration-[var(--dur-normal)] ease-[var(--ease-spring)]" />
        </span>
      </button>
      {toggle.isError && <Notice tone="danger">{toggle.error.message}</Notice>}

      {online ? (
        <>
          <GpsStatus state={gps.state} />
          <Panel>
            <EmptyState
              icon={<Radio className="size-6" aria-hidden />}
              title={t('rider.online')}
              body={t('rider.waiting')}
            />
          </Panel>
        </>
      ) : (
        <Panel>
          <EmptyState
            icon={<Wallet className="size-6" aria-hidden />}
            title={t('rider.offline')}
            body={t('rider.offlineBody')}
          />
        </Panel>
      )}
    </div>
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

export function RiderEarnings() {
  const { t, i18n } = useTranslation();
  const jobs = useQuery({
    queryKey: ['rider', 'jobs'],
    queryFn: () =>
      api<
        Array<{
          id: string;
          code: string;
          status: string;
          riderEarning: string;
          cancellationFee: string;
          updatedAt: string;
        }>
      >('/rider/jobs'),
  });
  const today = new Date().toDateString();
  const ledger = useQuery({
    queryKey: ['rider', 'ledger'],
    queryFn: () =>
      api<{
        balance: string;
        entries: Array<{
          id: string;
          type: 'commission' | 'settlement' | 'adjustment';
          amount: string;
          deliveryCode: string | null;
          createdAt: string;
        }>;
      }>('/rider/ledger'),
  });
  const done = jobs.data?.filter((j) => ['delivered', 'returned'].includes(j.status)) ?? [];
  const todaySum = done
    .filter((j) => new Date(j.updatedAt).toDateString() === today)
    .reduce((s, j) => s + Math.round(Number(j.riderEarning) * 100), 0);

  return (
    <div className="flex flex-col gap-5 p-4">
      <h1 className="pt-3 text-[26px] font-bold tracking-tight">{t('rider.earnings.title')}</h1>
      <div className="rounded-[var(--radius-xl)] bg-accent-soft p-6 text-accent-soft-ink shadow-[var(--shadow-sm)]">
        <p className="text-xs font-semibold tracking-wide uppercase opacity-70">{t('rider.earnings.today')}</p>
        <p className="mt-1 text-[40px] font-bold tracking-tight tabular">
          {(todaySum / 100).toFixed(2)} <span className="text-base font-semibold">ETB</span>
        </p>
      </div>
      {ledger.data && (
        <Panel className="p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-semibold">{t('rider.earnings.owed')}</p>
            <p className="text-xl font-bold tabular">{ledger.data.balance} ETB</p>
          </div>
          <p className="mt-1 text-sm text-ink-3">{t('rider.earnings.owedHint')}</p>
          {ledger.data.entries.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-ink-2">
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
      {jobs.isPending && <Skeleton className="h-24 w-full" />}
      {jobs.data && jobs.data.length === 0 && (
        <EmptyState title={t('rider.earnings.title')} body={t('rider.earnings.empty')} />
      )}
      {jobs.data && jobs.data.length > 0 && (
        <Panel className="divide-y divide-line">
          {jobs.data.map((j) => (
            <div key={j.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="font-semibold tabular">#{j.code}</p>
                <p className="text-sm text-ink-3">
                  {t(`delivery.statuses.${j.status}`)} ·{' '}
                  {new Date(j.updatedAt).toLocaleDateString(
                    i18n.language === 'am' ? 'am-ET' : 'en-GB',
                    { day: 'numeric', month: 'short' },
                  )}
                </p>
              </div>
              <span className="font-semibold tabular">{j.riderEarning} ETB</span>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}
