import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Bike, ChevronRight, LogOut, Package, UserRound } from 'lucide-react';
import { formatPhone } from '@dp/shared';
import { useSession, useSignOut } from '../../lib/session.tsx';
import { Button, Notice, Panel } from '../../ui/index.ts';
import { LanguageToggle } from './LanguageToggle.tsx';

export function AccountPanel({ signInPath }: { signInPath: string }) {
  const { t } = useTranslation();
  const { data: user } = useSession();
  const signOut = useSignOut(signInPath);
  if (!user) return null;
  const initials = (user.fullName ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

  return (
    <div className="flex flex-col gap-4 px-4 pt-6 pb-6">
      <h1 className="text-center text-xl font-bold tracking-tight">{t('account.title')}</h1>
      <div className="relative flex items-center gap-4 overflow-hidden rounded-[var(--radius-2xl)] bg-navy p-5 text-navy-ink shadow-[var(--shadow-lg)]">
        <div className="pointer-events-none absolute -top-14 -right-14 size-44 rounded-full bg-accent/30 blur-3xl" aria-hidden />
        <span className="relative flex size-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-2 to-accent text-xl font-bold text-white ring-4 ring-white/10">
          {initials || <UserRound className="size-7" aria-hidden />}
        </span>
        <div className="relative min-w-0">
          <p className="truncate text-lg font-bold">{user.fullName ?? '—'}</p>
          <p className="text-sm text-navy-ink/65 tabular">{formatPhone(user.phone)}</p>
        </div>
      </div>
      <Panel>
        <dl className="divide-y divide-line">
          <Row label={t('account.name')} value={user.fullName ?? '—'} />
          <Row label={t('account.phone')} value={formatPhone(user.phone)} mono />
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-sm text-ink-3">{t('account.language')}</dt>
            <dd>
              <LanguageToggle />
            </dd>
          </div>
        </dl>
      </Panel>
      <SwitchApp inRiderApp={signInPath.startsWith('/rider')} isRider={user.role === 'rider'} />
      <p className="px-1 text-sm text-ink-3">{t('account.sessionNote')}</p>
      {signOut.isError && <Notice tone="danger">{signOut.error.message}</Notice>}
      <Button
        variant="danger-soft"
        size="lg"
        block
        loading={signOut.isPending}
        icon={<LogOut className="size-5" aria-hidden />}
        onClick={() => signOut.mutate()}
      >
        {signOut.isPending ? t('auth.signingOut') : t('auth.signOut')}
      </Button>
    </div>
  );
}

/** One phone number works in both apps: customers can apply to ride, riders can still send. */
function SwitchApp({ inRiderApp, isRider }: { inRiderApp: boolean; isRider: boolean }) {
  const { t } = useTranslation();
  const card = inRiderApp
    ? { key: 'send', to: '/', icon: Package }
    : isRider
      ? { key: 'riderApp', to: '/rider', icon: Bike }
      : { key: 'becomeRider', to: '/rider', icon: Bike };
  const Icon = card.icon;
  return (
    <Panel className="flex items-center gap-4 p-4">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-accent-soft text-accent-soft-ink">
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t(`account.switch.${card.key}.title`)}</p>
        <p className="text-sm text-ink-3">{t(`account.switch.${card.key}.body`)}</p>
      </div>
      <Link
        to={card.to}
        className="inline-flex h-10 shrink-0 items-center gap-1 rounded-[var(--radius-md)] bg-accent px-3 text-sm font-semibold text-white"
      >
        {t(`account.switch.${card.key}.action`)}
        <ChevronRight className="size-4" aria-hidden />
      </Link>
    </Panel>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className={mono ? 'font-medium tabular' : 'font-medium'}>{value}</dd>
    </div>
  );
}
