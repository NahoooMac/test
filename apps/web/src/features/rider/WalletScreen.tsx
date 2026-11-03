import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Star, Trophy, Wallet } from 'lucide-react';
import type { WalletEligibility } from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import { Badge, Button, ChoiceGroup, Notice, Panel, Skeleton, TextField, useToast } from '../../ui/index.ts';
import { riderKeys, useRiderCopy, useStanding, useWallet } from './features.ts';

const when = (iso: string, lang: string) =>
  new Date(iso).toLocaleString(lang === 'am' ? 'am-ET' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Banner shown on home/jobs when the wallet blocks new jobs. Online status is never affected. */
export function LowWalletBanner({ wallet }: { wallet: WalletEligibility | undefined }) {
  const c = useRiderCopy();
  if (!wallet || wallet.canTakeWork) return null;
  return (
    <Link
      to="/rider/wallet"
      className="flex items-center gap-3 rounded-[var(--radius-md)] bg-warning-soft px-4 py-3 text-sm font-medium text-warning"
    >
      <Wallet className="size-5 shrink-0" aria-hidden />
      <span className="flex-1">
        {c.wallet.lowShort} · {wallet.balance} ETB
      </span>
      <ChevronRight className="size-4" aria-hidden />
    </Link>
  );
}

export function WalletScreen() {
  const c = useRiderCopy();
  const { i18n } = useTranslation();
  const wallet = useWallet();
  const w = wallet.data;
  const negative = w ? Number(w.balance) < 0 : false;

  return (
    <div className="flex flex-col gap-5 px-4 pt-6 pb-6">
      <h1 className="text-center text-xl font-bold tracking-tight">{c.wallet.title}</h1>
      {wallet.isPending && <Skeleton className="h-40 w-full" />}
      {w && (
        <Panel className="p-5">
          <p className="text-sm text-ink-3">{c.wallet.balance}</p>
          <p className={`text-4xl font-bold tabular ${negative ? 'text-danger' : ''}`}>
            {w.balance} <span className="text-lg font-semibold text-ink-3">ETB</span>
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-[var(--radius-md)] bg-surface-2 p-3">
              <dt className="text-ink-3">{c.wallet.minimum}</dt>
              <dd className="font-semibold tabular">{w.minBalance} ETB</dd>
            </div>
            <div className="rounded-[var(--radius-md)] bg-surface-2 p-3">
              <dt className="text-ink-3">{c.wallet.limit}</dt>
              <dd className="font-semibold tabular">−{w.debtLimit} ETB</dd>
            </div>
          </dl>
          {!w.canTakeWork && (
            <Notice tone="warning" className="mt-4">
              {w.issue === 'at_debt_limit' ? c.wallet.atLimit : c.wallet.low}
            </Notice>
          )}
          <p className="mt-4 text-sm text-ink-3">{c.wallet.explain}</p>
        </Panel>
      )}

      <TopUpForm />

      {w && w.topups.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold tracking-tight">{c.wallet.topups}</h2>
          <Panel className="divide-y divide-line">
            {w.topups.map((tp) => (
              <div key={tp.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold tabular">{tp.amount} ETB</p>
                  <p className="truncate text-ink-3">
                    {tp.method === 'telebirr' ? 'Telebirr' : 'CBE Birr'} · {tp.reference} · {when(tp.createdAt, i18n.language)}
                  </p>
                  {tp.status === 'rejected' && tp.reviewNote && <p className="text-danger">{tp.reviewNote}</p>}
                </div>
                <Badge tone={tp.status === 'verified' ? 'success' : tp.status === 'rejected' ? 'danger' : 'warning'}>
                  {c.wallet.statuses[tp.status]}
                </Badge>
              </div>
            ))}
          </Panel>
        </section>
      )}

      {w && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold tracking-tight">{c.wallet.ledger}</h2>
          {w.entries.length === 0 ? (
            <p className="text-sm text-ink-3">{c.wallet.noEntries}</p>
          ) : (
            <Panel className="divide-y divide-line">
              {w.entries.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {c.wallet.types[e.type]}
                      {e.deliveryCode ? ` · #${e.deliveryCode}` : ''}
                    </p>
                    <p className="truncate text-ink-3">
                      {when(e.createdAt, i18n.language)}
                      {e.note && e.type === 'adjustment' ? ` · ${e.note}` : ''}
                    </p>
                  </div>
                  <span className={`font-semibold tabular ${e.amount.startsWith('-') ? 'text-danger' : 'text-success'}`}>
                    {e.amount.startsWith('-') ? e.amount : `+${e.amount}`}
                  </span>
                </div>
              ))}
            </Panel>
          )}
        </section>
      )}

      <StandingCard />

      <Link to="/rider/earnings" className="text-center text-sm font-semibold text-accent">
        {c.wallet.earnings}
      </Link>
    </div>
  );
}

function TopUpForm() {
  const c = useRiderCopy();
  const toast = useToast();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'telebirr' | 'cbe_birr'>('telebirr');
  const [reference, setReference] = useState('');
  const submit = useMutation({
    mutationFn: () => api('/rider/wallet/topups', { method: 'POST', body: { amount, method, reference } }),
    onSuccess: () => {
      toast(c.wallet.submitted, 'success');
      setAmount('');
      setReference('');
      void qc.invalidateQueries({ queryKey: riderKeys.wallet });
    },
  });
  const fields = submit.error instanceof ApiRequestError ? submit.error.fields : undefined;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };

  return (
    <Panel className="p-5">
      <h2 className="text-lg font-bold tracking-tight">{c.wallet.topUpTitle}</h2>
      <p className="mt-1 text-sm text-ink-3">{c.wallet.topUpSteps}</p>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <ChoiceGroup
          legend={c.wallet.method}
          value={method}
          onChange={setMethod}
          choices={[
            { value: 'telebirr', label: 'Telebirr' },
            { value: 'cbe_birr', label: 'CBE Birr' },
          ]}
        />
        <TextField
          label={c.wallet.amount}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={fields?.amount}
          required
        />
        <TextField
          label={c.wallet.reference}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          error={fields?.reference}
          autoCapitalize="characters"
          autoComplete="off"
          required
        />
        {submit.error && !fields && <Notice tone="danger">{submit.error.message}</Notice>}
        <Button type="submit" block loading={submit.isPending}>
          {c.wallet.submit}
        </Button>
      </form>
    </Panel>
  );
}

function StandingCard() {
  const c = useRiderCopy();
  const { i18n } = useTranslation();
  const standing = useStanding();
  const s = standing.data;
  if (!s) return standing.isPending ? <Skeleton className="h-28 w-full" /> : null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-bold tracking-tight">{c.standing.title}</h2>
      <div className="grid grid-cols-2 gap-3">
        <Panel className="p-4">
          <p className="flex items-center gap-1.5 text-sm text-ink-3">
            <Trophy className="size-4" aria-hidden /> {c.standing.points}
          </p>
          <p className="text-3xl font-bold tabular">{s.points}</p>
        </Panel>
        <Panel className="p-4">
          <p className="flex items-center gap-1.5 text-sm text-ink-3">
            <Star className="size-4" aria-hidden /> {c.standing.rating}
          </p>
          {s.rating.average != null ? (
            <>
              <p className="text-3xl font-bold tabular">{s.rating.average.toFixed(1)}</p>
              <p className="text-xs text-ink-3">{c.standing.ratings(s.rating.count)}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-3">{c.standing.noRating}</p>
          )}
        </Panel>
      </div>
      <p className="text-xs text-ink-3">{c.standing.pointsHint}</p>
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-accent">{c.standing.history}</summary>
        <Panel className="mt-2 divide-y divide-line">
          {s.pointsHistory.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <p>
                  {c.standing.types[p.type]}
                  {p.deliveryCode ? ` · #${p.deliveryCode}` : ''}
                </p>
                <p className="truncate text-xs text-ink-3">
                  {when(p.createdAt, i18n.language)}
                  {p.type === 'adjustment' ? ` · ${p.reason}` : ''}
                </p>
              </div>
              <span className={`font-semibold tabular ${p.delta < 0 ? 'text-danger' : 'text-success'}`}>
                {p.delta > 0 ? `+${p.delta}` : p.delta}
              </span>
            </div>
          ))}
        </Panel>
      </details>
    </section>
  );
}
