// Admin pages for the rider features: wallets and audited corrections, top-up verification,
// ratings review, delivery history with route replay and export, and platform settings.
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, X } from 'lucide-react';
import {
  formatPhone,
  subCityName,
  type DeliveryHistoryDetail,
  type PlatformSettings,
  type PointsEntry,
  type WalletEligibility,
  type WalletEntry,
  type WalletTopup,
} from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Notice,
  Panel,
  Segmented,
  Skeleton,
  TextField,
  useToast,
} from '../../ui/index.ts';
import { HistoryDetailView } from '../rider/HistoryScreen.tsx';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function PageHead({ title, sub, aside }: { title: string; sub: string; aside?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">{title}</h1>
        <p className="text-[15px] text-ink-2">{sub}</p>
      </div>
      {aside}
    </div>
  );
}

const exportLink =
  'inline-flex h-11 items-center gap-2 rounded-[var(--radius-lg)] border border-line-strong bg-surface px-4 text-sm font-semibold shadow-[var(--shadow-xs)] hover:bg-surface-2';

// ── Wallets ──────────────────────────────────────────────────────────────────

interface WalletRow extends WalletEligibility {
  id: string;
  name: string | null;
  phone: string;
  vehicleType: string;
  approvalStatus: string;
  points: number;
  pendingTopups: number;
}

interface RiderFeatures {
  wallet: WalletEligibility;
  entries: WalletEntry[];
  topups: WalletTopup[];
  points: number;
  pointsHistory: PointsEntry[];
  serviceAreas: string[];
  home: { lat: number; lng: number; radiusKm: number } | null;
  rating: { average: number | null; count: number };
}

export function WalletsAdmin() {
  const wallets = useQuery({ queryKey: ['admin', 'wallets'], queryFn: () => api<WalletRow[]>('/admin/wallets') });
  const [selected, setSelected] = useState<WalletRow | null>(null);
  return (
    <div className="flex max-w-7xl flex-col gap-5">
      <PageHead
        title="Rider wallets"
        sub="Prepaid commission balances. Commission comes off when a delivery is completed; top-ups add credit after verification."
      />
      <DataTable
        caption="Rider wallets"
        rows={wallets.data ?? []}
        loading={wallets.isPending}
        rowKey={(r) => r.id}
        onRowClick={setSelected}
        empty={<EmptyState title="No riders yet" />}
        columns={[
          { key: 'name', header: 'Rider', cell: (r) => <span className="font-semibold">{r.name ?? formatPhone(r.phone)}</span> },
          { key: 'vehicle', header: 'Vehicle', cell: (r) => r.vehicleType },
          {
            key: 'balance',
            header: 'Balance',
            align: 'right',
            cell: (r) => <span className={`tabular font-semibold ${Number(r.balance) < 0 ? 'text-danger' : ''}`}>{r.balance}</span>,
          },
          {
            key: 'state',
            header: 'Can take jobs',
            cell: (r) =>
              r.canTakeWork ? <Badge tone="success">Yes</Badge> : <Badge tone="warning">{r.issue === 'at_debt_limit' ? 'At debt limit' : 'Below minimum'}</Badge>,
          },
          { key: 'points', header: 'Points', align: 'right', cell: (r) => <span className="tabular">{r.points}</span> },
          { key: 'topups', header: 'Pending top-ups', align: 'right', cell: (r) => (r.pendingTopups ? <Badge tone="info">{r.pendingTopups}</Badge> : '—') },
        ]}
      />
      {selected && <RiderWalletPanel row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function RiderWalletPanel({ row, onClose }: { row: WalletRow; onClose: () => void }) {
  const qc = useQueryClient();
  const key = ['admin', 'rider-features', row.id];
  const data = useQuery({ queryKey: key, queryFn: () => api<RiderFeatures>(`/admin/riders/${row.id}/features`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['admin', 'wallets'] });
  };
  const f = data.data;
  return (
    <Panel className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{row.name ?? formatPhone(row.phone)}</h2>
          <p className="text-sm text-ink-3">{formatPhone(row.phone)}</p>
        </div>
        <Button variant="ghost" size="sm" aria-label="Close" icon={<X className="size-4" />} onClick={onClose} />
      </div>
      {data.isPending && <Skeleton className="mt-4 h-40 w-full" />}
      {f && (
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <Stat k="Balance" v={`${f.wallet.balance} ETB`} />
              <Stat k="Minimum" v={`${f.wallet.minBalance} ETB`} />
              <Stat k="Debt limit" v={`−${f.wallet.debtLimit} ETB`} />
              <Stat k="Points" v={String(f.points)} />
              <Stat k="Rating" v={f.rating.average != null ? `${f.rating.average.toFixed(2)} (${f.rating.count})` : 'None yet'} />
              <Stat k="Areas" v={f.serviceAreas.length ? f.serviceAreas.map((s) => subCityName(s, 'en')).join(', ') : 'All'} />
            </dl>
            <p className="text-xs text-ink-3">
              Home location: {f.home ? `set (${f.home.radiusKm} km radius) — private, admins only` : 'not set'}
            </p>
            <AdjustForm
              title="Adjust wallet"
              hint="+ adds credit, − deducts (e.g. -25). A debit can never pass the debt limit."
              field="amount"
              url={`/admin/riders/${row.id}/wallet/adjust`}
              onDone={refresh}
            />
            <AdjustForm
              title="Correct points"
              hint="Whole number between −100 and 100. Optionally link a delivery code."
              field="delta"
              url={`/admin/riders/${row.id}/points/adjust`}
              onDone={refresh}
              withCode
            />
          </div>
          <div className="flex flex-col gap-4">
            <List
              title="Wallet ledger"
              rows={f.entries.map((e) => ({
                id: e.id,
                left: `${e.type}${e.deliveryCode ? ` · #${e.deliveryCode}` : ''}${e.note ? ` · ${e.note}` : ''}`,
                sub: when(e.createdAt),
                right: e.amount,
              }))}
            />
            <List
              title="Points history"
              rows={f.pointsHistory.map((p) => ({
                id: p.id,
                left: `${p.type.replace('_', ' ')}${p.deliveryCode ? ` · #${p.deliveryCode}` : ''} · ${p.reason}`,
                sub: when(p.createdAt),
                right: p.delta > 0 ? `+${p.delta}` : String(p.delta),
              }))}
            />
          </div>
        </div>
      )}
    </Panel>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-[var(--radius-md)] bg-surface-2 p-2.5">
      <dt className="text-xs text-ink-3">{k}</dt>
      <dd className="font-semibold tabular">{v}</dd>
    </div>
  );
}

function List({ title, rows }: { title: string; rows: { id: string; left: string; sub: string; right: string }[] }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-3">Nothing yet.</p>
      ) : (
        <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-[var(--radius-md)] border border-line text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate">{r.left}</span>
                <span className="text-xs text-ink-3">{r.sub}</span>
              </span>
              <span className={`shrink-0 font-semibold tabular ${r.right.startsWith('-') ? 'text-danger' : ''}`}>{r.right}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AdjustForm({
  title,
  hint,
  field,
  url,
  onDone,
  withCode,
}: {
  title: string;
  hint: string;
  field: 'amount' | 'delta';
  url: string;
  onDone: () => void;
  withCode?: boolean;
}) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const send = useMutation({
    mutationFn: () =>
      api(url, {
        method: 'POST',
        body: {
          [field]: field === 'delta' ? Number(value) : value,
          reason,
          ...(withCode && code.trim() ? { deliveryCode: code.trim() } : {}),
        },
      }),
    onSuccess: () => {
      toast('Saved and recorded in the audit log', 'success');
      setValue('');
      setReason('');
      setCode('');
      onDone();
    },
  });
  const fields = send.error instanceof ApiRequestError ? send.error.fields : undefined;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send.mutate();
  };
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-line p-3">
      <p className="font-semibold">{title}</p>
      <p className="text-xs text-ink-3">{hint}</p>
      <div className="grid grid-cols-2 gap-2">
        <TextField label={field === 'amount' ? 'Amount (ETB)' : 'Points'} value={value} onChange={(e) => setValue(e.target.value)} error={fields?.[field]} required />
        {withCode && <TextField label="Delivery code" value={code} onChange={(e) => setCode(e.target.value)} error={fields?.deliveryCode} />}
      </div>
      <TextField label="Reason (required, audited)" value={reason} onChange={(e) => setReason(e.target.value)} error={fields?.reason} required />
      {send.error && !fields && <Notice tone="danger">{send.error.message}</Notice>}
      <Button type="submit" size="sm" loading={send.isPending}>
        Apply
      </Button>
    </form>
  );
}

// ── Top-ups ──────────────────────────────────────────────────────────────────

interface TopupRow extends WalletTopup {
  riderId: string;
  riderName: string | null;
  phone: string;
}

export function TopupsAdmin() {
  const [status, setStatus] = useState<'pending' | 'verified' | 'rejected'>('pending');
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({
    queryKey: ['admin', 'topups', status],
    queryFn: () => api<TopupRow[]>(`/admin/topups?status=${status}`),
  });
  const review = useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'verify' | 'reject'; note?: string }) =>
      api(`/admin/topups/${id}/review`, { method: 'POST', body: { decision, ...(note ? { note } : {}) } }),
    onSuccess: (_d, v) => {
      toast(v.decision === 'verify' ? 'Verified — wallet credited' : 'Rejected — nothing credited', 'success');
      void qc.invalidateQueries({ queryKey: ['admin', 'topups'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'wallets'] });
    },
    onError: (err) => toast(err.message, 'danger'),
  });
  return (
    <div className="flex max-w-7xl flex-col gap-5">
      <PageHead
        title="Top-up verification"
        sub="Check each transfer in the Telebirr / CBE Birr statement before verifying. A screenshot or the rider's word is not proof."
      />
      <Segmented
        label="Status"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'pending', label: 'Pending' },
          { value: 'verified', label: 'Verified' },
          { value: 'rejected', label: 'Rejected' },
        ]}
      />
      <DataTable
        caption="Top-ups"
        rows={list.data ?? []}
        loading={list.isPending}
        rowKey={(r) => r.id}
        empty={<EmptyState title="Nothing here" />}
        columns={[
          { key: 'when', header: 'Submitted', cell: (r) => when(r.createdAt) },
          { key: 'rider', header: 'Rider', cell: (r) => <span className="font-semibold">{r.riderName ?? formatPhone(r.phone)}</span> },
          { key: 'method', header: 'Method', cell: (r) => (r.method === 'telebirr' ? 'Telebirr' : 'CBE Birr') },
          { key: 'ref', header: 'Transaction ID', cell: (r) => <code className="text-sm">{r.reference}</code> },
          { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <span className="tabular font-semibold">{r.amount}</span> },
          {
            key: 'actions',
            header: 'Actions',
            hideHeader: true,
            cell: (r) =>
              r.status === 'pending' ? (
                <div className="flex justify-end gap-2">
                  <Button size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: r.id, decision: 'verify' })}>
                    Verify
                  </Button>
                  <Button
                    size="sm"
                    variant="danger-soft"
                    disabled={review.isPending}
                    onClick={() => {
                      const note = window.prompt('Why is this top-up rejected? (shown to the rider)');
                      if (note) review.mutate({ id: r.id, decision: 'reject', note });
                    }}
                  >
                    Reject
                  </Button>
                </div>
              ) : (
                <span className="text-sm text-ink-3">{r.reviewNote ?? (r.reviewedAt ? when(r.reviewedAt) : '')}</span>
              ),
          },
        ]}
      />
    </div>
  );
}

// ── Ratings ──────────────────────────────────────────────────────────────────

interface RatingRow {
  deliveryId: string;
  code: string;
  riderName: string | null;
  customerName: string | null;
  stars: number;
  comment: string | null;
  status: 'active' | 'reported' | 'removed';
  reportReason: string | null;
  reviewNote: string | null;
  createdAt: string;
  flags: string[];
}

export function RatingsAdmin() {
  const [status, setStatus] = useState<'reported' | 'active' | 'removed'>('reported');
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({
    queryKey: ['admin', 'ratings', status],
    queryFn: () => api<RatingRow[]>(`/admin/ratings?status=${status}`),
  });
  const review = useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'keep' | 'remove'; note: string }) =>
      api(`/admin/ratings/${id}/review`, { method: 'POST', body: { decision, note } }),
    onSuccess: () => {
      toast('Saved', 'success');
      void qc.invalidateQueries({ queryKey: ['admin', 'ratings'] });
    },
    onError: (err) => toast(err.message, 'danger'),
  });
  const decide = (id: string, decision: 'keep' | 'remove') => {
    const note = window.prompt(decision === 'remove' ? 'Why remove this rating?' : 'Why keep this rating?');
    if (note) review.mutate({ id, decision, note });
  };
  return (
    <div className="flex max-w-7xl flex-col gap-5">
      <PageHead title="Ratings review" sub="Ratings riders reported, with simple abuse signals. Removed ratings stop counting." />
      <Segmented
        label="Status"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'reported', label: 'Reported' },
          { value: 'active', label: 'Active' },
          { value: 'removed', label: 'Removed' },
        ]}
      />
      <DataTable
        caption="Ratings"
        rows={list.data ?? []}
        loading={list.isPending}
        rowKey={(r) => r.deliveryId}
        empty={<EmptyState title="Nothing here" />}
        columns={[
          { key: 'when', header: 'Date', cell: (r) => when(r.createdAt) },
          { key: 'code', header: 'Delivery', cell: (r) => `#${r.code}` },
          { key: 'rider', header: 'Rider', cell: (r) => r.riderName ?? '—' },
          { key: 'customer', header: 'Customer', cell: (r) => r.customerName ?? '—' },
          { key: 'stars', header: 'Stars', cell: (r) => '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars) },
          {
            key: 'detail',
            header: 'Comment / report',
            cell: (r) => (
              <div className="text-sm">
                {r.comment && <p>“{r.comment}”</p>}
                {r.reportReason && <p className="text-warning">Rider: {r.reportReason}</p>}
                {r.reviewNote && <p className="text-ink-3">Review: {r.reviewNote}</p>}
                <div className="mt-1 flex flex-wrap gap-1">
                  {r.flags.map((f) => (
                    <Badge key={f} tone="warning">
                      {f === 'repeat_customer' ? 'Repeat customer' : '1★ no comment'}
                    </Badge>
                  ))}
                </div>
              </div>
            ),
          },
          {
            key: 'actions',
            header: 'Actions',
            hideHeader: true,
            cell: (r) =>
              r.status !== 'removed' && (
                <div className="flex justify-end gap-2">
                  {r.status === 'reported' && (
                    <Button size="sm" variant="secondary" onClick={() => decide(r.deliveryId, 'keep')}>
                      Keep
                    </Button>
                  )}
                  <Button size="sm" variant="danger-soft" onClick={() => decide(r.deliveryId, 'remove')}>
                    Remove
                  </Button>
                </div>
              ),
          },
        ]}
      />
    </div>
  );
}

// ── Delivery history ─────────────────────────────────────────────────────────

interface AdminHistoryRow {
  id: string;
  code: string;
  status: string;
  vehicleType: string;
  riderName: string | null;
  pickupAddress: string;
  dropoffAddress: string;
  fare: string;
  commission: string | null;
  distanceKm: number;
  routePoints: number;
  updatedAt: string;
}

export function HistoryAdmin() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState<'all' | 'completed' | 'unsuccessful'>('all');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = new URLSearchParams();
  if (group !== 'all') params.set('group', group);
  if (q.trim()) params.set('q', q.trim());
  if (from) params.set('from', new Date(from).toISOString());
  if (to) params.set('to', new Date(`${to}T23:59:59`).toISOString());
  const qs = params.toString();
  const list = useQuery({
    queryKey: ['admin', 'history', qs],
    queryFn: () => api<AdminHistoryRow[]>(`/admin/history${qs ? `?${qs}` : ''}`),
  });

  if (id) return <AdminHistoryDetail id={id} onBack={() => navigate('/admin/history')} />;
  return (
    <div className="flex max-w-7xl flex-col gap-5">
      <PageHead
        title="Delivery history"
        sub="Finished deliveries with the route each rider actually travelled. Opening a route is recorded in the audit log."
        aside={
          <a href={`/api/admin/history.csv${qs ? `?${qs}` : ''}`} className={exportLink}>
            <Download className="size-4" aria-hidden /> Export CSV
          </a>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <Segmented
          label="Outcome"
          value={group}
          onChange={setGroup}
          options={[
            { value: 'all', label: 'All' },
            { value: 'completed', label: 'Completed' },
            { value: 'unsuccessful', label: 'Cancelled / failed' },
          ]}
        />
        <TextField label="Delivery code" value={q} onChange={(e) => setQ(e.target.value)} className="w-40" />
        <TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
        <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
      </div>
      <DataTable
        caption="Delivery history"
        rows={list.data ?? []}
        loading={list.isPending}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/admin/history/${r.id}`)}
        empty={<EmptyState title="No deliveries match" />}
        columns={[
          { key: 'code', header: 'Code', cell: (r) => <span className="font-semibold">#{r.code}</span> },
          { key: 'status', header: 'Status', cell: (r) => <Badge tone={r.status === 'delivered' ? 'success' : 'warning'}>{r.status}</Badge> },
          { key: 'rider', header: 'Rider', cell: (r) => r.riderName ?? '—' },
          { key: 'route', header: 'Route', cell: (r) => <span className="text-sm">{r.pickupAddress} → {r.dropoffAddress}</span> },
          { key: 'fare', header: 'Fare', align: 'right', cell: (r) => <span className="tabular">{r.fare}</span> },
          { key: 'commission', header: 'Commission', align: 'right', cell: (r) => <span className="tabular">{r.commission ?? '—'}</span> },
          { key: 'gps', header: 'GPS points', align: 'right', cell: (r) => (r.routePoints ? r.routePoints : <span className="text-ink-3">none</span>) },
          { key: 'when', header: 'Updated', cell: (r) => when(r.updatedAt) },
        ]}
      />
    </div>
  );
}

function AdminHistoryDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const detail = useQuery({
    queryKey: ['admin', 'history', 'detail', id],
    queryFn: () => api<DeliveryHistoryDetail>(`/admin/deliveries/${id}/history`),
  });
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
        ← Delivery history
      </Button>
      {detail.isPending && <Skeleton className="h-80 w-full" />}
      {detail.error && <Notice tone="danger">{detail.error.message}</Notice>}
      {detail.data && <HistoryDetailView d={detail.data} />}
    </div>
  );
}

// ── Platform settings ────────────────────────────────────────────────────────

const WEIGHTS: Array<[keyof PlatformSettings['matching'], string]> = [
  ['distancePerKm', 'Distance penalty per km'],
  ['homeBonus', 'Near-home bonus'],
  ['ratingPerStar', 'Per rating star'],
  ['pointsPerPoint', 'Per point'],
  ['idlePerHour', 'Fairness per idle hour'],
  ['cancelPenalty', 'Per recent rider cancellation'],
];

export function PlatformSettingsPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ['admin', 'platform-settings'], queryFn: () => api<PlatformSettings>('/admin/settings/platform') });
  const [draft, setDraft] = useState<PlatformSettings | null>(null);
  const [reason, setReason] = useState('');
  const s = draft ?? settings.data;
  const save = useMutation({
    mutationFn: () =>
      api<PlatformSettings>('/admin/settings/platform', {
        method: 'PUT',
        body: {
          walletMinBalance: s!.walletMinBalance,
          walletDebtLimit: s!.walletDebtLimit,
          matching: s!.matching,
          routeRetentionDays: s!.routeRetentionDays,
          reason,
        },
      }),
    onSuccess: (data) => {
      qc.setQueryData(['admin', 'platform-settings'], data);
      setDraft(null);
      setReason('');
      toast('Settings saved and audited', 'success');
    },
  });
  const fields = save.error instanceof ApiRequestError ? save.error.fields : undefined;
  if (!s) return <Skeleton className="h-60 w-full" />;
  const set = (patch: Partial<PlatformSettings>) => setDraft({ ...s, ...patch });

  return (
    <Panel className="p-5">
      <h2 className="text-lg font-bold">Wallet, matching and retention</h2>
      <p className="text-sm text-ink-3">Every change needs a reason and is recorded with who changed what.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <TextField
          label="Minimum balance to take jobs (ETB)"
          value={s.walletMinBalance}
          onChange={(e) => set({ walletMinBalance: e.target.value })}
          error={fields?.walletMinBalance}
        />
        <TextField
          label="Debt limit (ETB below zero)"
          value={s.walletDebtLimit}
          onChange={(e) => set({ walletDebtLimit: e.target.value })}
          error={fields?.walletDebtLimit}
        />
        <TextField
          label="Keep GPS routes (days)"
          type="number"
          value={String(s.routeRetentionDays)}
          onChange={(e) => set({ routeRetentionDays: Number(e.target.value) })}
          error={fields?.routeRetentionDays}
        />
      </div>
      <h3 className="mt-5 font-semibold">Matching weights</h3>
      <p className="text-xs text-ink-3">Signals only rank eligible riders; they never override vehicle, area, approval or wallet rules.</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        {WEIGHTS.map(([k, label]) => (
          <TextField
            key={k}
            label={label}
            type="number"
            step="0.1"
            value={String(s.matching[k])}
            onChange={(e) => set({ matching: { ...s.matching, [k]: Number(e.target.value) } })}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-3">
        <TextField label="Reason for this change" value={reason} onChange={(e) => setReason(e.target.value)} error={fields?.reason} />
        {save.error && !fields && <Notice tone="danger">{save.error.message}</Notice>}
        <Button className="self-start" loading={save.isPending} disabled={!draft} onClick={() => save.mutate()}>
          Save settings
        </Button>
      </div>
    </Panel>
  );
}
