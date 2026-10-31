import { NavLink, Outlet, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BadgeDollarSign, LogOut, Map, Package, Scale, Users, UserCog } from 'lucide-react';
import { SUB_CITIES, formatPhone } from '@dp/shared';
import { RequireRole, useSession, useSignOut } from '../../lib/session.tsx';
import { useTheme } from '../../lib/theme.ts';
import { SignInFlow } from '../../features/auth/SignInFlow.tsx';
import { RidersAdmin } from '../../features/admin/RidersAdmin.tsx';
import { LiveOps } from '../../features/admin/LiveOps.tsx';
import { LanguageToggle } from '../../features/auth/LanguageToggle.tsx';
import { EmptyState, cn } from '../../ui/index.ts';
import { Wordmark } from '../Wordmark.tsx';

export default function AdminApp() {
  useTheme('system');
  return (
    <Routes>
      <Route path="sign-in" element={<AdminSignIn />} />
      <Route
        element={
          <RequireRole role="admin" signInPath="/admin/sign-in">
            <AdminShell />
          </RequireRole>
        }
      >
        <Route index element={<LiveOps />} />
        <Route path="riders" element={<RidersAdmin />} />
        <Route path="*" element={<EmptyState title="Coming in Phase 4d" />} />
      </Route>
    </Routes>
  );
}

function AdminSignIn() {
  const { t } = useTranslation();
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="hidden flex-col justify-between bg-inverse p-10 text-inverse-ink lg:flex">
        <Wordmark suffix="Operations" inverse />
        <div>
          <p className="text-sm font-semibold tracking-wide text-inverse-ink/60 uppercase">
            Service area
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[15px]">
            {SUB_CITIES.map((s) => (
              <li key={s.slug} className="flex items-baseline gap-2">
                <span>{s.nameEn}</span>
                <span className="text-sm text-inverse-ink/50">{s.nameAm}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-inverse-ink/50">Addis Ababa</p>
      </aside>

      <div className="flex flex-col px-5 pt-4 pb-safe sm:px-10">
        <header className="flex items-center justify-between lg:justify-end">
          <Wordmark suffix="Ops" className="lg:hidden" />
          <LanguageToggle />
        </header>
        <SignInFlow
          homePath="/admin"
          submitSize="md"
          intro={
            <>
              <h1 className="text-2xl font-bold tracking-tight">{t('auth.admin.title')}</h1>
              <p className="mt-1 text-ink-2">{t('auth.admin.subtitle')}</p>
            </>
          }
          layout={(heading, form) => (
            <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 py-10">
              {heading}
              {form}
            </div>
          )}
        />
      </div>
    </main>
  );
}

function AdminShell() {
  const { t } = useTranslation();
  const items = [
    { to: '/admin', label: t('nav.liveOps'), icon: Map, end: true },
    { to: '/admin/deliveries', label: t('nav.deliveries'), icon: Package, end: false },
    { to: '/admin/riders', label: t('nav.riders'), icon: UserCog, end: false },
    { to: '/admin/reconciliation', label: t('nav.reconciliation'), icon: Scale, end: false },
    { to: '/admin/pricing', label: t('nav.pricing'), icon: BadgeDollarSign, end: false },
    { to: '/admin/users', label: t('nav.users'), icon: Users, end: false },
  ];
  return (
    <div className="grid min-h-dvh grid-cols-[240px_minmax(0,1fr)]">
      <nav className="flex flex-col gap-1 border-r border-line bg-surface p-3" aria-label="Admin">
        <Wordmark suffix="Ops" className="mb-4 px-2 pt-2" />
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium',
                isActive ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
              )
            }
          >
            <Icon className="size-4.5" aria-hidden />
            {label}
          </NavLink>
        ))}
        <AdminUser />
      </nav>
      <main className="min-w-0 p-6">
        <Outlet />
      </main>
    </div>
  );
}

function AdminUser() {
  const { t } = useTranslation();
  const { data: user } = useSession();
  const signOut = useSignOut('/admin/sign-in');
  if (!user) return null;
  return (
    <div className="mt-auto border-t border-line px-2 pt-3">
      <p className="truncate text-sm font-semibold">{user.fullName ?? 'Admin'}</p>
      <p className="text-xs text-ink-3 tabular">{formatPhone(user.phone)}</p>
      <button
        type="button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
        className="mt-2 flex h-9 items-center gap-2 text-sm font-medium text-ink-2 hover:text-danger disabled:opacity-50"
      >
        <LogOut className="size-4" aria-hidden />
        {signOut.isPending ? t('auth.signingOut') : t('auth.signOut')}
      </button>
    </div>
  );
}
