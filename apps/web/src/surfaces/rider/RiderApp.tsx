import { useEffect, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Home, Wallet, UserRound } from 'lucide-react';
import { FullScreenLoader, RequireRole, useSession } from '../../lib/session.tsx';
import { ApplyForm } from '../../features/rider/ApplyForm.tsx';
import { RiderEarnings, RiderHomeScreen } from '../../features/rider/RiderHomeScreen.tsx';
import { useTheme } from '../../lib/theme.ts';
import { armRingtone } from '../../lib/ringtone.ts';
import { SignInFlow } from '../../features/auth/SignInFlow.tsx';
import { AccountPanel } from '../../features/auth/AccountPanel.tsx';
import { AuthScaffold } from '../../features/auth/AuthScaffold.tsx';
import { Badge, BottomNav } from '../../ui/index.ts';

export default function RiderApp() {
  useTheme();
  // Unlock sound on the rider's first tap, so the job ringtone can play later.
  useEffect(() => armRingtone(), []);
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
          <h1 className="text-[32px] leading-[1.1] font-bold tracking-tight">
            {t('auth.rider.title')}
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-3">{t('auth.rider.subtitle')}</p>
        </>
      }
      layout={(heading, form) => (
        <AuthScaffold
          vehicle="motorcycle"
          badge={<Badge tone="accent">Rider</Badge>}
          heading={heading}
          form={form}
        />
      )}
    />
  );
}

function RiderShell() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
      <BottomNav
        label="Rider"
        left={[
          { to: '/rider', label: t('nav.home'), icon: Home, end: true },
          { to: '/rider/earnings', label: t('nav.earnings'), icon: Wallet },
          { to: '/rider/account', label: t('nav.account'), icon: UserRound },
        ]}
      />
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
