import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';
import { formatPhone } from '@dp/shared';
import { useSession, useSignOut } from '../../lib/session.tsx';
import { Button, Notice, Panel } from '../../ui/index.ts';
import { LanguageToggle } from './LanguageToggle.tsx';

export function AccountPanel({ signInPath }: { signInPath: string }) {
  const { t } = useTranslation();
  const { data: user } = useSession();
  const signOut = useSignOut(signInPath);
  if (!user) return null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="pt-2 text-2xl font-bold tracking-tight">{t('account.title')}</h1>
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

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className={mono ? 'font-medium tabular' : 'font-medium'}>{value}</dd>
    </div>
  );
}
