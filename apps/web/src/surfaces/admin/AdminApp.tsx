import { NavLink, Outlet, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  BadgeDollarSign,
  LogOut,
  Map,
  Package,
  Scale,
  ScanFace,
  Settings,
  ShieldCheck,
  Users,
  UserCog,
} from 'lucide-react';
import { SUB_CITIES, formatPhone } from '@dp/shared';
import { RequireRole, useSession, useSignOut } from '../../lib/session.tsx';
import { useTheme } from '../../lib/theme.ts';
import { AdminPasswordForm } from '../../features/auth/AdminPasswordForm.tsx';
import { RidersAdmin } from '../../features/admin/RidersAdmin.tsx';
import { KycAdmin } from '../../features/admin/KycAdmin.tsx';
import { LiveOps } from '../../features/admin/LiveOps.tsx';
import { DeliveriesAdmin } from '../../features/admin/DeliveriesAdmin.tsx';
import { ReconciliationAdmin } from '../../features/admin/FinanceAdmin.tsx';
import { PricingAdmin } from '../../features/admin/PricingAdmin.tsx';
import { UsersAdmin } from '../../features/admin/UsersAdmin.tsx';
import { AdminSettings } from '../../features/admin/AdminSettings.tsx';
import { LanguageToggle } from '../../features/auth/LanguageToggle.tsx';
import { CitySkyline, EmptyState, cn } from '../../ui/index.ts';
import { Wordmark } from '../Wordmark.tsx';

export default function AdminApp() {
  useTheme('light');
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
        <Route path="verification" element={<KycAdmin />} />
        <Route path="verification/:id" element={<KycAdmin />} />
        <Route path="deliveries" element={<DeliveriesAdmin />} />
        <Route path="deliveries/:id" element={<DeliveriesAdmin />} />
        <Route path="reconciliation" element={<ReconciliationAdmin />} />
        <Route path="pricing" element={<PricingAdmin />} />
        <Route path="users" element={<UsersAdmin />} />
        <Route path="settings" element={<AdminSettings />} />
        <Route path="*" element={<EmptyState title="Page not found" />} />
      </Route>
    </Routes>
  );
}

function AdminSignIn() {
  const { t } = useTranslation();
  return (
    <main className="grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-navy p-10 text-navy-ink lg:flex">
        <div
          className="pointer-events-none absolute -top-40 -right-40 size-[28rem] rounded-full bg-accent/25 blur-3xl"
          aria-hidden
        />
        <Wordmark suffix="Operations" inverse size="lg" className="relative" />
        <div className="relative">
          <p className="text-xs font-semibold tracking-widest text-navy-ink/50 uppercase">
            Service area
          </p>
          <ul className="mt-5 grid grid-cols-2 gap-x-8 gap-y-2.5 text-[15px]">
            {SUB_CITIES.map((s) => (
              <li key={s.slug} className="flex items-baseline gap-2">
                <span className="font-medium">{s.nameEn}</span>
                <span className="text-sm text-navy-ink/40">{s.nameAm}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-navy-ink/40">Addis Ababa</p>
      </aside>

      <div className="relative flex flex-col overflow-hidden px-6 pt-5 pb-safe sm:px-10">
        <header className="relative z-10 flex items-center justify-between lg:justify-end">
          <Wordmark suffix="Ops" className="lg:hidden" />
          <LanguageToggle />
        </header>
        <CitySkyline className="absolute inset-x-0 bottom-0 h-40 w-full" />
        <div className="relative z-10 mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 pt-10 pb-44">
          <div className="flex flex-col items-center text-center">
            <span className="mb-5 flex size-16 items-center justify-center rounded-[var(--radius-xl)] bg-gradient-to-br from-accent-2 to-accent text-white shadow-[0_12px_28px_-8px_rgba(37,99,235,0.6)]">
              <ShieldCheck className="size-8" aria-hidden />
            </span>
            <h1 className="text-[28px] font-bold tracking-tight">{t('auth.admin.title')}</h1>
            <p className="mt-2 text-[15px] text-ink-3">{t('auth.admin.subtitle')}</p>
          </div>
          <div className="animate-fade-in">
            <AdminPasswordForm homePath="/admin" />
          </div>
        </div>
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
    { to: '/admin/verification', label: t('nav.verification'), icon: ScanFace, end: false },
    { to: '/admin/reconciliation', label: t('nav.reconciliation'), icon: Scale, end: false },
    { to: '/admin/pricing', label: t('nav.pricing'), icon: BadgeDollarSign, end: false },
    { to: '/admin/users', label: t('nav.users'), icon: Users, end: false },
    { to: '/admin/settings', label: t('nav.settings'), icon: Settings, end: false },
  ];
  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <nav
        className={cn(
          'sticky top-0 z-20 flex items-center gap-1 overflow-x-auto border-b border-line bg-surface/95 px-3 py-2 backdrop-blur-md',
          'lg:h-dvh lg:flex-col lg:items-stretch lg:overflow-visible lg:border-b-0 lg:bg-navy lg:p-4 lg:text-navy-ink lg:backdrop-blur-none',
        )}
        aria-label="Admin"
      >
        <span className="mr-2 shrink-0 lg:hidden">
          <Wordmark suffix="Ops" />
        </span>
        <span className="mb-7 hidden px-2 pt-3 lg:block">
          <Wordmark suffix="Ops" inverse />
        </span>
        <div className="flex gap-1 lg:flex-col lg:gap-1">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-10 shrink-0 items-center gap-3 rounded-[var(--radius-md)] px-3 text-sm font-medium whitespace-nowrap lg:h-11',
                  'transition-colors duration-[var(--dur-fast)]',
                  isActive
                    ? 'bg-accent text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,0.7)]'
                    : 'text-ink-2 hover:bg-surface-2 hover:text-ink lg:text-navy-ink/65 lg:hover:bg-white/5 lg:hover:text-navy-ink',
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
      <main className="min-w-0 p-4 lg:p-8">
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
  const initials = (user.fullName ?? 'Admin')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return (
    <div className="ml-auto shrink-0 lg:mt-auto lg:ml-0 lg:rounded-[var(--radius-lg)] lg:bg-white/5 lg:p-3">
      <div className="hidden items-center gap-3 lg:flex">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-2 to-accent text-sm font-bold text-white">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{user.fullName ?? 'Admin'}</p>
          <p className="text-xs text-navy-ink/55 tabular">{formatPhone(user.phone)}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
        className="flex h-9 items-center gap-2 text-sm font-medium text-ink-2 hover:text-danger disabled:opacity-50 lg:mt-2 lg:text-navy-ink/65"
      >
        <LogOut className="size-4" aria-hidden />
        {signOut.isPending ? t('auth.signingOut') : t('auth.signOut')}
      </button>
    </div>
  );
}
