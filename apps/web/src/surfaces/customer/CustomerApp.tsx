import { NavLink, Outlet, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Home, Package, UserRound } from 'lucide-react';
import { RequireRole, useSession } from '../../lib/session.tsx';
import { useTheme } from '../../lib/theme.ts';
import { SignInFlow } from '../../features/auth/SignInFlow.tsx';
import { AccountPanel } from '../../features/auth/AccountPanel.tsx';
import { LanguageToggle } from '../../features/auth/LanguageToggle.tsx';
import { RouteMotif } from '../../features/auth/RouteMotif.tsx';
import { EmptyState, cn } from '../../ui/index.ts';
import { Wordmark } from '../Wordmark.tsx';

export default function CustomerApp() {
  useTheme('system');
  return (
    <Routes>
      <Route path="sign-in" element={<CustomerSignIn />} />
      <Route
        element={
          <RequireRole role="customer" signInPath="/sign-in">
            <CustomerShell />
          </RequireRole>
        }
      >
        <Route index element={<CustomerHome />} />
        <Route path="deliveries" element={<EmptyState title="No deliveries yet" />} />
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
  const { data: user } = useSession();
  const firstName = user?.fullName?.split(' ')[0];
  return (
    <div className="p-4">
      <p className="pt-2 text-sm text-ink-3">Selam{firstName ? `, ${firstName}` : ''}</p>
      <h1 className="text-2xl font-bold tracking-tight">Send a parcel</h1>
      <EmptyState
        className="mt-6"
        title="Booking opens in Phase 4"
        body="You're signed in. This device will stay signed in until you sign out."
      />
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
