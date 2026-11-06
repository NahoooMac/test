import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  BadgeDollarSign,
  History,
  LogOut,
  Star,
  Wallet,
  Map,
  Menu,
  Package,
  Scale,
  ScanFace,
  Settings,
  ShieldCheck,
  Users,
  UserCog,
  X,
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
import {
  HistoryAdmin,
  RatingsAdmin,
  TopupsAdmin,
  WalletsAdmin,
} from '../../features/admin/RiderFeaturesAdmin.tsx';
import { NotificationsBell } from '../../features/admin/NotificationsBell.tsx';
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
        <Route path="wallets" element={<WalletsAdmin />} />
        <Route path="topups" element={<TopupsAdmin />} />
        <Route path="ratings" element={<RatingsAdmin />} />
        <Route path="history" element={<HistoryAdmin />} />
        <Route path="history/:id" element={<HistoryAdmin />} />
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
    { to: '/admin/history', label: 'History', icon: History, end: false },
    { to: '/admin/wallets', label: 'Wallets', icon: Wallet, end: false },
    { to: '/admin/topups', label: 'Top-ups', icon: BadgeDollarSign, end: false },
    { to: '/admin/ratings', label: 'Ratings', icon: Star, end: false },
    { to: '/admin/reconciliation', label: t('nav.reconciliation'), icon: Scale, end: false },
    { to: '/admin/pricing', label: t('nav.pricing'), icon: BadgeDollarSign, end: false },
    { to: '/admin/users', label: t('nav.users'), icon: Users, end: false },
    { to: '/admin/settings', label: t('nav.settings'), icon: Settings, end: false },
  ];
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = items.find((i) =>
    i.end ? location.pathname === i.to : location.pathname.startsWith(i.to),
  );

  // Close the drawer on navigation and on Escape; stop the page scrolling behind it.
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [menuOpen]);

  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      {/* Desktop: fixed sidebar. */}
      <aside className="sticky top-0 hidden h-dvh lg:block">
        <AdminNav items={items} />
      </aside>

      {/* Phones and tablets: top bar with a hamburger that opens the same menu as a drawer. */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-3 backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="admin-menu"
          className="flex size-10 items-center justify-center rounded-[var(--radius-md)] text-ink hover:bg-surface-2"
        >
          <Menu className="size-6" aria-hidden />
        </button>
        <Wordmark suffix="Ops" />
        {current && (
          <span className="ml-auto truncate pr-12 text-sm font-semibold text-ink-2">
            {current.label}
          </span>
        )}
      </header>

      <div
        className={cn(
          'fixed inset-0 z-40 lg:hidden',
          menuOpen ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        aria-hidden={!menuOpen}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
          className={cn(
            'absolute inset-0 bg-black/50 transition-opacity duration-[var(--dur-normal)]',
            menuOpen ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div
          id="admin-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Admin menu"
          className={cn(
            'absolute inset-y-0 left-0 w-[min(18rem,85vw)] shadow-[var(--shadow-xl)]',
            'transition-transform duration-[var(--dur-normal)] ease-[var(--ease-out)]',
            menuOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          {/* Only mounted while open, so its links aren't tabbable when hidden. */}
          {menuOpen && <AdminNav items={items} onClose={() => setMenuOpen(false)} />}
        </div>
      </div>

      <NotificationsBell />

      <main className="min-w-0 p-4 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}

type NavItem = { to: string; label: string; icon: typeof Map; end: boolean };

/** The navy menu: sidebar on desktop, drawer content on phones. */
function AdminNav({ items, onClose }: { items: NavItem[]; onClose?: () => void }) {
  const ref = useRef<HTMLElement>(null);
  // As a drawer: move keyboard focus into the menu once it has slid in.
  useEffect(() => {
    if (!onClose) return;
    const id = requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('a')?.focus());
    return () => cancelAnimationFrame(id);
    // Once, when the drawer opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <nav
      ref={ref}
      className="flex h-full flex-col overflow-y-auto bg-navy p-4 text-navy-ink"
      aria-label="Admin"
    >
      <div className="mb-7 flex items-center justify-between px-2 pt-3">
        <Wordmark suffix="Ops" inverse />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex size-9 items-center justify-center rounded-full text-navy-ink/70 hover:bg-white/10 hover:text-navy-ink"
          >
            <X className="size-5" aria-hidden />
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex h-11 shrink-0 items-center gap-3 rounded-[var(--radius-md)] px-3 text-sm font-medium whitespace-nowrap',
                'transition-colors duration-[var(--dur-fast)]',
                isActive
                  ? 'bg-accent text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,0.7)]'
                  : 'text-navy-ink/65 hover:bg-white/5 hover:text-navy-ink',
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
    <div className="mt-auto shrink-0 rounded-[var(--radius-lg)] bg-white/5 p-3">
      <div className="flex items-center gap-3">
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
        className="mt-2 flex h-9 items-center gap-2 text-sm font-medium text-navy-ink/65 hover:text-danger disabled:opacity-50"
      >
        <LogOut className="size-4" aria-hidden />
        {signOut.isPending ? t('auth.signingOut') : t('auth.signOut')}
      </button>
    </div>
  );
}
