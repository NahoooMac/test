import { PaymentNotice } from '../../features/deliveries/PaymentNotice.tsx';
import { Link, Outlet, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ChevronRight, Home, MapPin, Package, ReceiptText, Search, UserRound } from 'lucide-react';
import type { DeliverySummary, VehicleType } from '@dp/shared';
import { RequireRole, useSession } from '../../lib/session.tsx';
import { useTheme } from '../../lib/theme.ts';
import { SignInFlow } from '../../features/auth/SignInFlow.tsx';
import { AccountPanel } from '../../features/auth/AccountPanel.tsx';
import { AuthScaffold } from '../../features/auth/AuthScaffold.tsx';
import { BookingFlow } from '../../features/booking/BookingFlow.tsx';
import { DeliveryDetail } from '../../features/deliveries/DeliveryDetail.tsx';
import {
  DeliveryCard,
  DeliveryList,
  STATUS_TEXT,
  useDeliveries,
} from '../../features/deliveries/DeliveryList.tsx';
import { isOpen, STAGE_KEYS, STATUS_TONE, stageIndex } from '../../features/deliveries/status.ts';
import { VehicleHero } from '../../map/VehicleHero.tsx';
import {
  BottomNav,
  ParcelIcon3D,
  Skeleton,
  StatusProgress,
  cn,
} from '../../ui/index.ts';

export default function CustomerApp() {
  useTheme();
  return (
    <Routes>
      <Route path="sign-in" element={<CustomerSignIn />} />
      {/* Full-screen flows without the tab bar. */}
      <Route
        path="send"
        element={
          <RequireRole role="customer" signInPath="/sign-in">
            <BookingFlow />
          </RequireRole>
        }
      />
      <Route
        element={
          <RequireRole role="customer" signInPath="/sign-in">
            <CustomerShell />
          </RequireRole>
        }
      >
        <Route index element={<CustomerHome />} />
        <Route path="deliveries" element={<DeliveryList />} />
        <Route path="deliveries/:id" element={<DeliveryDetail />} />
        <Route path="account" element={<AccountPanel signInPath="/sign-in" />} />
      </Route>
    </Routes>
  );
}

function CustomerSignIn() {
  const { t } = useTranslation();
  return (
    <SignInFlow
      homePath="/"
      intro={
        <>
          <h1 className="text-[32px] leading-[1.1] font-bold tracking-tight text-balance">
            {t('auth.customer.title')}
          </h1>
          <p className="mt-2 text-[15px] font-medium text-accent">{t('auth.customer.tagline')}</p>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-3">
            {t('auth.customer.subtitle')}
          </p>
        </>
      }
      layout={(heading, form) => (
        <AuthScaffold vehicle="motorcycle" heading={heading} form={form} />
      )}
    />
  );
}

// Light tints by day, deep blues at night (text uses theme colours, so it stays readable).
const VEHICLE_CARDS: { type: VehicleType; bg: string }[] = [
  { type: 'motorcycle', bg: 'from-[#dbeafe] to-[#bfdbfe] dark:from-[#172554] dark:to-[#1e3a8a]' },
  { type: 'bicycle', bg: 'from-[#e0f2fe] to-[#bae6fd] dark:from-[#082f49] dark:to-[#0c4a6e]' },
  { type: 'scooter', bg: 'from-[#e0e7ff] to-[#c7d2fe] dark:from-[#1e1b4b] dark:to-[#312e81]' },
];

function initials(name: string | null | undefined) {
  if (!name) return null;
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

function CustomerHome() {
  const { t } = useTranslation();
  const { data: user } = useSession();
  const deliveries = useDeliveries();
  const firstName = user?.fullName?.split(' ')[0];
  const open = deliveries.data?.filter((d) => isOpen(d.status)) ?? [];
  const recent = deliveries.data?.filter((d) => !isOpen(d.status)).slice(0, 3) ?? [];
  const ini = initials(user?.fullName);

  return (
    <div className="flex flex-col gap-6 px-4 pt-5 pb-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[17px] font-bold">
            <MapPin className="size-5 fill-accent/15 text-accent" aria-hidden />
            {t('delivery.city')}
          </p>
          <p className="mt-0.5 truncate pl-6.5 text-sm text-ink-3">
            {t('delivery.greeting')}
            {firstName ? `, ${firstName}` : ''}
          </p>
        </div>
        <Link
          to="/account"
          aria-label={t('nav.account')}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-2 to-accent text-sm font-bold text-white shadow-[var(--shadow-md)] ring-2 ring-surface"
        >
          {ini ?? <UserRound className="size-5" aria-hidden />}
        </Link>
      </header>

      <Link
        to="/send"
        className="flex h-14 items-center gap-3 rounded-[var(--radius-lg)] bg-surface px-4 text-[15px] text-ink-3 shadow-[var(--shadow-sm)] ring-1 ring-line/70 transition-shadow duration-[var(--dur-fast)] hover:shadow-[var(--shadow-md)]"
      >
        <Search className="size-5 text-ink-2" aria-hidden />
        <span className="flex-1">{t('booking.chooseDropoff')}</span>
        <span className="flex size-8 items-center justify-center rounded-full bg-accent text-white">
          <ArrowRight className="size-4" aria-hidden />
        </span>
      </Link>

      <section aria-label={t('booking.vehicleTitle')} className="-mx-4">
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
          {VEHICLE_CARDS.map((v) => (
            <Link
              key={v.type}
              to="/send"
              state={{ vehicle: v.type }}
              className={cn(
                'relative flex h-48 w-[47%] min-w-40 shrink-0 snap-start flex-col overflow-hidden rounded-[var(--radius-xl)] bg-gradient-to-br p-4',
                'shadow-[var(--shadow-sm)] transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] active:scale-[0.98]',
                v.bg,
              )}
            >
              <span className="text-[17px] font-bold text-ink">{t(`booking.vehicles.${v.type}`)}</span>
              <span className="text-[13px] leading-tight text-ink-2">
                {t(`booking.vehicleHints.${v.type}`)}
              </span>
              <VehicleHero
                kind={v.type}
                rider={false}
                width={260}
                height={180}
                className="absolute -right-3 bottom-0 w-[92%]"
              />
              <span className="mt-auto flex size-8 items-center justify-center rounded-full bg-navy text-white shadow-[var(--shadow-sm)]">
                <ArrowRight className="size-4" aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {deliveries.isPending && <Skeleton className="h-36 w-full rounded-[var(--radius-xl)]" />}

      {open.length > 0 && (
        <section className="flex flex-col gap-3 animate-fade-in">
          <SectionHead title={t('delivery.trackTitle')} to="/deliveries" />
          {open.map((d) => (
            <TrackCard key={d.id} d={d} />
          ))}
        </section>
      )}

      {deliveries.data && deliveries.data.length === 0 && (
        <Link
          to="/send"
          className="relative flex items-center gap-4 overflow-hidden rounded-[var(--radius-xl)] bg-navy p-5 text-navy-ink shadow-[var(--shadow-lg)]"
        >
          <div className="absolute -top-10 -right-10 size-36 rounded-full bg-accent/30 blur-2xl" aria-hidden />
          <ParcelIcon3D className="relative size-14 shrink-0" />
          <div className="relative min-w-0 flex-1">
            <p className="text-lg font-bold">{t('delivery.sendCta')}</p>
            <p className="text-sm text-navy-ink/70">{t('delivery.sendCtaBody')}</p>
          </div>
          <ChevronRight className="relative size-5 text-navy-ink/60" aria-hidden />
        </Link>
      )}

      {recent.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHead title={t('delivery.recentOrders')} to="/deliveries" />
          <div className="flex flex-col gap-2.5">
            {recent.map((d) => (
              <DeliveryCard key={d.id} d={d} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionHead({ title, to }: { title: string; to: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <Link
        to={to}
        className="flex items-center gap-0.5 text-sm font-medium text-ink-3 hover:text-accent"
      >
        {t('delivery.seeAll')}
        <ChevronRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}

function TrackCard({ d }: { d: DeliverySummary }) {
  const { t } = useTranslation();
  const stage = stageIndex(d.status);
  return (
    <Link
      to={`/deliveries/${d.id}`}
      className="relative block overflow-hidden rounded-[var(--radius-xl)] bg-surface p-4 shadow-[var(--shadow-md)] ring-1 ring-line/70 transition-shadow duration-[var(--dur-fast)] hover:shadow-[var(--shadow-lg)]"
    >
      <div className="flex items-center gap-3.5">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent-soft/70">
          <ParcelIcon3D className="size-9" />
        </span>
        <div className="min-w-0 flex-1 pr-20">
          <p className={cn('text-lg font-bold leading-tight', STATUS_TEXT[STATUS_TONE[d.status]])}>
            {t(`delivery.statuses.${d.status}`)}
          </p>
          <p className="mt-0.5 text-sm text-ink-3 tabular">
            {t('delivery.tripMin', { min: d.etaMin })} · #{d.code}
          </p>
        </div>
        <VehicleHero
          kind={d.vehicleType}
          width={200}
          height={150}
          className="absolute top-2 right-2 w-24"
        />
      </div>
      {stage >= 0 && (
        <div className="mt-4">
          <StatusProgress
            label={t('delivery.progress')}
            stages={STAGE_KEYS.map((k) => t(`delivery.stages.${k}`))}
            current={stage}
            showLabels={false}
          />
        </div>
      )}
    </Link>
  );
}

function CustomerShell() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <PaymentNotice />
      <main className="flex-1">
        <Outlet />
      </main>
      <BottomNav
        label="Main"
        left={[
          { to: '/', label: t('nav.home'), icon: Home, end: true },
          { to: '/deliveries', label: t('nav.deliveries'), icon: ReceiptText },
        ]}
        action={{ to: '/send', label: t('delivery.send'), icon: Package }}
        right={[{ to: '/account', label: t('nav.account'), icon: UserRound }]}
      />
    </div>
  );
}
