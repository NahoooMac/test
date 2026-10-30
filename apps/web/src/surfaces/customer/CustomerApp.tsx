import { Link, NavLink, Outlet, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Home, Package, Search, UserRound } from 'lucide-react';
import { RequireRole, useSession } from '../../lib/session.tsx';
import { useTheme } from '../../lib/theme.ts';
import { SignInFlow } from '../../features/auth/SignInFlow.tsx';
import { AccountPanel } from '../../features/auth/AccountPanel.tsx';
import { LanguageToggle } from '../../features/auth/LanguageToggle.tsx';
import { RouteMotif } from '../../features/auth/RouteMotif.tsx';
import { BookingFlow } from '../../features/booking/BookingFlow.tsx';
import { DeliveryDetail } from '../../features/deliveries/DeliveryDetail.tsx';
import {
  DeliveryCard,
  DeliveryList,
  useDeliveries,
} from '../../features/deliveries/DeliveryList.tsx';
import { isOpen } from '../../features/deliveries/status.ts';
import { MapView } from '../../map/MapView.tsx';
import { Skeleton, cn } from '../../ui/index.ts';
import { Wordmark } from '../Wordmark.tsx';

export default function CustomerApp() {
  useTheme('system');
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
          <RouteMotif className="mb-8 w-full max-w-xs" />
          <h1 className="text-[28px] leading-tight font-bold tracking-tight text-balance">
            {t('auth.customer.title')}
          </h1>
          <p className="mt-2 text-base text-ink-2">{t('auth.customer.subtitle')}</p>
        </>
      }
      layout={(heading, form) => (
        <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-4 pb-safe">
          <header className="flex items-center justify-between">
            <Wordmark />
            <LanguageToggle />
          </header>
          <div className="flex flex-1 flex-col justify-center py-8">{heading}</div>
          {form}
        </main>
      )}
    />
  );
}

function CustomerHome() {
  const { t } = useTranslation();
  const { data: user } = useSession();
  const deliveries = useDeliveries();
  const firstName = user?.fullName?.split(' ')[0];
  const open = deliveries.data?.filter((d) => isOpen(d.status)) ?? [];
  const recent = deliveries.data?.filter((d) => !isOpen(d.status)).slice(0, 3) ?? [];

  return (
    <div className="flex flex-col">
      <MapView className="h-[38dvh] min-h-56" zoom={12} interactive={false} />
      <div className="flex flex-col gap-4 px-4 pt-4 pb-6">
        <div>
          <p className="text-sm text-ink-3">Selam{firstName ? `, ${firstName}` : ''}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t('booking.title')}</h1>
        </div>
        <Link
          to="/send"
          className="flex h-14 items-center gap-3 rounded-2xl bg-ink px-4 font-semibold text-canvas shadow-sm"
        >
          <Search className="size-5" aria-hidden />
          <span className="flex-1">{t('booking.chooseDropoff')}</span>
          <ArrowRight className="size-5" aria-hidden />
        </Link>

        {deliveries.isPending && <Skeleton className="h-24 w-full" />}
        {open.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-ink-2">{t('delivery.active')}</h2>
            {open.map((d) => (
              <DeliveryCard key={d.id} d={d} />
            ))}
          </section>
        )}
        {recent.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-ink-2">{t('delivery.recent')}</h2>
            {recent.map((d) => (
              <DeliveryCard key={d.id} d={d} />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function CustomerShell() {
  const { t } = useTranslation();
  const tabs = [
    { to: '/', label: t('nav.home'), icon: Home, end: true },
    { to: '/deliveries', label: t('nav.deliveries'), icon: Package, end: false },
    { to: '/account', label: t('nav.account'), icon: UserRound, end: false },
  ];
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <main className="flex-1">
        <Outlet />
      </main>
      <nav
        className="sticky bottom-0 flex border-t border-line bg-surface pb-safe"
        aria-label="Main"
      >
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 pt-2 text-xs font-medium',
                isActive ? 'text-ink' : 'text-ink-3',
              )
            }
          >
            <Icon className="size-6" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
