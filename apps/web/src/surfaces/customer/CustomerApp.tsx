import { NavLink, Outlet, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Home, Package, UserRound } from 'lucide-react';
import { RequireRole } from '../../lib/session.tsx';
import { useTheme } from '../../lib/theme.ts';
import { PhoneSignIn } from '../../features/auth/PhoneSignIn.tsx';
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
        <Route
          index
          element={<EmptyState title="Booking" body="The booking flow is built in Phase 4." />}
        />
        <Route path="deliveries" element={<EmptyState title="No deliveries yet" />} />
        <Route path="account" element={<EmptyState title="Account" />} />
      </Route>
    </Routes>
  );
}

function CustomerSignIn() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-4 pb-safe">
      <header className="flex items-center justify-between">
        <Wordmark />
        <LanguageToggle />
      </header>

      <div className="flex flex-1 flex-col justify-center py-8">
        <RouteMotif className="mb-8 w-full max-w-xs" />
        <h1 className="text-[28px] leading-tight font-bold tracking-tight text-balance">
          {t('auth.customer.title')}
        </h1>
        <p className="mt-2 text-base text-ink-2">{t('auth.customer.subtitle')}</p>
      </div>

      <PhoneSignIn />
    </main>
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
