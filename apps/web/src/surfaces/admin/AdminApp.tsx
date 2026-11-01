import { NavLink, Outlet, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BadgeDollarSign, LogOut, Map, Package, Scale, Users, UserCog } from 'lucide-react';
import { SUB_CITIES, formatPhone } from '@dp/shared';
import { RequireRole, useSession, useSignOut } from '../../lib/session.tsx';
import { useTheme } from '../../lib/theme.ts';
import { SignInFlow } from '../../features/auth/SignInFlow.tsx';
import { RidersAdmin } from '../../features/admin/RidersAdmin.tsx';
import { LiveOps } from '../../features/admin/LiveOps.tsx';
import { DeliveriesAdmin } from '../../features/admin/DeliveriesAdmin.tsx';
import { ReconciliationAdmin } from '../../features/admin/FinanceAdmin.tsx';
import { PricingAdmin } from '../../features/admin/PricingAdmin.tsx';
import { UsersAdmin } from '../../features/admin/UsersAdmin.tsx';
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
        <Route path="deliveries" element={<DeliveriesAdmin />} />
        <Route path="deliveries/:id" element={<DeliveriesAdmin />} />
        <Route path="reconciliation" element={<ReconciliationAdmin />} />
        <Route path="pricing" element={<PricingAdmin />} />
        <Route path="users" element={<UsersAdmin />} />
        <Route path="*" element={<EmptyState title="Page not found" />} />
      </Route>
    </Routes>
  );
}

function AdminSignIn() {
  const { t } = useTranslation();
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="hidden flex-col justify-between bg-inverse p-10 text-inverse-ink lg:flex">
        <Wordmark suffix="Operations" inverse size="lg" />
        <div>
          <p className="text-xs font-semibold tracking-widest text-inverse-ink/50 uppercase">
            Service area
          </p>
          <ul className="mt-5 grid grid-cols-2 gap-x-8 gap-y-2.5 text-[15px]">
            {SUB_CITIES.map((s) => (
              <li key={s.slug} className="flex items-baseline gap-2">
                <span className="font-medium">{s.nameEn}</span>
                <span className="text-sm text-inverse-ink/40">{s.nameAm}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-inverse-ink/40">Addis Ababa</p>
      </aside>

      <div className="flex flex-col px-5 pt-5 pb-safe sm:px-10">
        <header className="flex items-center justify-between lg:justify-end">
          <Wordmark suffix="Ops" className="lg:hidden" />
          <LanguageToggle />
        </header>
        <SignInFlow
          homePath="/admin"
          submitSize="md"
          intro={
            <>
              <h1 className="text-[28px] font-bold tracking-tight">{t('auth.admin.title')}</h1>
              <p className="mt-2 text-[15px] text-ink-2">{t('auth.admin.subtitle')}</p>
            </>
          }
          layout={(heading, form) => (
            <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 py-10">
              {heading}
              <div className="animate-fade-in">{form}</div>
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
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav
        className={cn(
          'sticky top-0 z-20 flex items-center gap-1 overflow-x-auto border-b border-line bg-surface/95 backdrop-blur-md px-3 py-2',
          'lg:h-dvh lg:flex-col lg:items-stretch lg:overflow-visible lg:border-r lg:border-b-0 lg:bg-surface lg:p-4 lg:backdrop-blur-none',
        )}
        aria-label="Admin"
      >
        <Wordmark suffix="Ops" className="mr-2 shrink-0 lg:mr-0 lg:mb-6 lg:px-2 lg:pt-3" />
        <div className="flex gap-1 lg:flex-col lg:gap-0.5">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-10 shrink-0 items-center gap-3 rounded-[var(--radius-sm)] px-3 text-sm font-medium whitespace-nowrap',
                  'transition-colors duration-[var(--dur-fast)]',
                  isActive
                    ? 'bg-accent-soft text-accent-soft-ink shadow-[var(--shadow-xs)]'
                    : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                )
              }
            >
              <Icon className="size-[18px]" aria-hidden />
              {label}
            </NavLink>
          ))}
        </div>
        <AdminUser />
      </nav>
      <main className="min-w-0 p-4 lg:p-6">
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
    <div className="ml-auto shrink-0 lg:mt-auto lg:ml-0 lg:border-t lg:border-line lg:px-2 lg:pt-3">
      <p className="hidden truncate text-sm font-semibold lg:block">{user.fullName ?? 'Admin'}</p>
      <p className="hidden text-xs text-ink-3 tabular lg:block">{formatPhone(user.phone)}</p>
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
