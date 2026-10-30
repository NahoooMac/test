import { NavLink, Outlet, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Bike, Wallet, UserRound } from 'lucide-react';
import { RequireRole } from '../../lib/session.tsx';
import { useTheme } from '../../lib/theme.ts';
import { PhoneSignIn } from '../../features/auth/PhoneSignIn.tsx';
import { LanguageToggle } from '../../features/auth/LanguageToggle.tsx';
import { Badge, EmptyState, cn } from '../../ui/index.ts';
import { Wordmark } from '../Wordmark.tsx';

export default function RiderApp() {
  useTheme('system');
  return (
    <Routes>
      <Route path="sign-in" element={<RiderSignIn />} />
      <Route
        element={
          <RequireRole role="rider" signInPath="/rider/sign-in">
            <RiderShell />
          </RequireRole>
        }
      >
        <Route index element={<EmptyState title="You're offline" body="Jobs are built in Phase 4." />} />
        <Route path="earnings" element={<EmptyState title="No earnings yet" />} />
        <Route path="account" element={<EmptyState title="Account" />} />
      </Route>
    </Routes>
  );
}

function RiderSignIn() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-4 pb-safe">
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Wordmark />
          <Badge tone="accent">Rider</Badge>
        </span>
        <LanguageToggle />
      </header>

      <div className="flex flex-1 flex-col justify-end pb-8">
        <span className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-ink text-accent">
          <Bike className="size-9" aria-hidden />
        </span>
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">{t('auth.rider.title')}</h1>
        <p className="mt-2 text-base text-ink-2">{t('auth.rider.subtitle')}</p>
      </div>

      <PhoneSignIn />
    </main>
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
      <main className="flex-1">
        <Outlet />
      </main>
      <nav className="sticky bottom-0 flex border-t border-line bg-surface pb-safe" aria-label="Rider">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 pt-2 text-xs font-semibold',
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
