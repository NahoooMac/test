import type { ReactNode } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Bike, Wallet, UserRound } from 'lucide-react';
import { FullScreenLoader, RequireRole, useSession } from '../../lib/session.tsx';
import { ApplyForm } from '../../features/rider/ApplyForm.tsx';
import { RiderEarnings, RiderHomeScreen } from '../../features/rider/RiderHomeScreen.tsx';
import { useTheme } from '../../lib/theme.ts';
import { SignInFlow } from '../../features/auth/SignInFlow.tsx';
import { AccountPanel } from '../../features/auth/AccountPanel.tsx';
import { LanguageToggle } from '../../features/auth/LanguageToggle.tsx';
import { Badge, cn } from '../../ui/index.ts';
import { Wordmark } from '../Wordmark.tsx';

export default function RiderApp() {
  useTheme('system');
  return (
    <Routes>
      <Route path="sign-in" element={<RiderSignIn />} />
      <Route
        element={
          <RiderGate>
            <RiderShell />
          </RiderGate>
        }
      >
        <Route index element={<RiderHomeScreen />} />
        <Route path="earnings" element={<RiderEarnings />} />
        <Route path="account" element={<AccountPanel signInPath="/rider/sign-in" />} />
      </Route>
    </Routes>
  );
}

function RiderSignIn() {
  const { t } = useTranslation();
  return (
    <SignInFlow
      homePath="/rider"
      intro={
        <>
          <span className="mb-8 flex size-18 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-ink shadow-[var(--shadow-sm)]">
            <Bike className="size-10" aria-hidden />
          </span>
          <h1 className="text-[32px] leading-[1.1] font-bold tracking-tight">
            {t('auth.rider.title')}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            {t('auth.rider.subtitle')}
          </p>
        </>
      }
      layout={(heading, form) => (
        <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-5 pb-safe">
          <header className="flex items-center justify-between">
            <span className="flex items-center gap-2.5">
              <Wordmark />
              <Badge tone="accent">Rider</Badge>
            </span>
            <LanguageToggle />
          </header>
          <div className="flex flex-1 flex-col justify-end pb-10">{heading}</div>
          <div className="animate-fade-in">{form}</div>
        </main>
      )}
    />
  );
}

function RiderShell() {
  const { t } = useTranslation();
  const tabs = [
    { to: '/rider', label: t('nav.jobs'), icon: Bike, end: true },
    { to: '/rider/earnings', label: t('nav.earnings'), icon: Wallet, end: false },
    { to: '/rider/account', label: t('nav.account'), icon: UserRound, end: false },
  ];
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
      <nav
        className="sticky bottom-0 z-30 flex border-t border-line bg-surface/95 backdrop-blur-md pb-safe"
        aria-label="Rider"
      >
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'relative flex flex-1 flex-col items-center gap-0.5 pt-2.5 text-[11px] font-semibold',
                'transition-colors duration-[var(--dur-fast)]',
                isActive ? 'text-accent' : 'text-ink-3 hover:text-ink-2',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute top-0 h-0.5 w-6 rounded-full bg-accent" aria-hidden />
                )}
                <Icon className="size-5" aria-hidden strokeWidth={isActive ? 2.5 : 2} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/**
 * A new account (role "customer" with no bookings) may apply to ride, so it gets the application
 * form instead of a "wrong area" message. Everything else follows the normal role guard.
 */
function RiderGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  if (session.isPending) return <FullScreenLoader />;
  if (session.data === null) {
    return <Navigate to="/rider/sign-in" replace state={{ from: location.pathname }} />;
  }
  if (session.data?.role === 'customer') return <ApplyForm />;
  return (
    <RequireRole role="rider" signInPath="/rider/sign-in">
      {children}
    </RequireRole>
  );
}
