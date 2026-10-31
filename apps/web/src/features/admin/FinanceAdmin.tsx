import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { formatPhone, type PaymentMethod } from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import {
  Button,
  ChoiceGroup,
  DataTable,
  EmptyState,
  Notice,
  Panel,
  Skeleton,
  TextField,
  useToast,
} from '../../ui/index.ts';

interface Recon {
  riders: Array<{
    riderId: string;
    name: string | null;
    phone: string;
    plate: string | null;
    commission: string;
    settled: string;
    adjustments: string;
    balance: string;
    deliveries: number;
    lastSettlementAt: string | null;
  }>;
  totals: {
    faresCollectedByRiders: string;
    commissionOwed: string;
    settled: string;
    outstanding: string;
  };
}

interface Ledger {
  balance: string;
  entries: Array<{
    id: string;
    type: string;
    amount: string;
    method: string | null;
    reference: string | null;
    note: string | null;
    deliveryCode: string | null;
    createdAt: string;
  }>;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Commission riders owe on fares they collected directly, and the settlements they have made. */
export function ReconciliationAdmin() {
  const recon = useQuery({
    queryKey: ['admin', 'reconciliation'],
    queryFn: () => api<Recon>('/admin/reconciliation'),
  });
  const [selected, setSelected] = useState<Recon['riders'][number] | null>(null);
  const t = recon.data?.totals;

  return (
    <div className="flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reconciliation</h1>
          <p className="text-ink-2">
            Customers pay riders directly. Riders owe the platform its commission until they settle.
          </p>
        </div>
        <a
          href="/api/admin/reconciliation.csv"
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-2"
        >
          <Download className="size-4" aria-hidden /> Export CSV
        </a>
      </div>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(
          [
            ['Fares collected by riders', t?.faresCollectedByRiders],
            ['Commission owed', t?.commissionOwed],
            ['Settled', t?.settled],
            ['Outstanding', t?.outstanding],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-line bg-surface px-4 py-3">
            <dt className="text-sm text-ink-3">{k}</dt>
            <dd className="text-2xl font-bold tabular">
              {v ?? '—'} <span className="text-sm font-medium text-ink-3">ETB</span>
            </dd>
          </div>
        ))}
      </dl>

      <DataTable
        caption="Riders"
        rows={recon.data?.riders ?? []}
        loading={recon.isPending}
        rowKey={(r) => r.riderId}
        onRowClick={setSelected}
        empty={
          <EmptyState
            title="Nothing to reconcile yet"
            body="Riders appear here once they record a fare payment."
          />
        }
        columns={[
          {
            key: 'rider',
            header: 'Rider',
            cell: (r) => (
              <div>
                <p className="font-semibold">{r.name ?? '—'}</p>
                <p className="text-xs text-ink-3 tabular">
                  {formatPhone(r.phone)}
                  {r.plate ? ` · ${r.plate}` : ''}
                </p>
              </div>
            ),
          },
          { key: 'deliveries', header: 'Paid jobs', align: 'right', cell: (r) => r.deliveries },
          { key: 'commission', header: 'Commission', align: 'right', cell: (r) => r.commission },
          { key: 'settled', header: 'Settled', align: 'right', cell: (r) => r.settled },
          {
            key: 'balance',
            header: 'Outstanding',
            align: 'right',
            cell: (r) => (
              <span className={Number(r.balance) > 0 ? 'font-bold' : 'text-ink-3'}>
                {r.balance}
              </span>
            ),
          },
          {
            key: 'last',
            header: 'Last settlement',
            align: 'right',
            cell: (r) =>
              r.lastSettlementAt ? (
                when(r.lastSettlementAt)
              ) : (
                <span className="text-ink-3">never</span>
              ),
          },
        ]}
      />

      {selected && <RiderLedger rider={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function RiderLedger({ rider, onClose }: { rider: Recon['riders'][number]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const ledger = useQuery({
    queryKey: ['admin', 'ledger', rider.riderId],
    queryFn: () => api<Ledger>(`/admin/riders/${rider.riderId}/ledger`),
  });
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('telebirr');
  const [reference, setReference] = useState('');
  // One key per settlement form: a double click or retry cannot record it twice.
  const [key, setKey] = useState(() => crypto.randomUUID());

  const settle = useMutation({
    mutationFn: () =>
      api<{ created: boolean; balance: string }>(`/admin/riders/${rider.riderId}/settlements`, {
        method: 'POST',
        body: { amount, method, reference: reference.trim() || undefined },
        headers: { 'Idempotency-Key': key },
      }),
    onSuccess: (r) => {
      toast(
        r.created ? `Settlement recorded. Outstanding: ${r.balance} ETB.` : 'Already recorded.',
        'success',
      );
      setAmount('');
      setReference('');
      setKey(crypto.randomUUID());
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });
  const fields = settle.error instanceof ApiRequestError ? settle.error.fields : undefined;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Panel className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-semibold">Record a settlement</h2>
            <p className="text-sm text-ink-2">
              {rider.name ?? formatPhone(rider.phone)} owes{' '}
              <span className="font-bold tabular">{ledger.data?.balance ?? rider.balance} ETB</span>
            </p>
          </div>
          <Button variant="ghost" className="h-8 px-2 text-sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <TextField
          label="Amount received (ETB)"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={fields?.amount}
        />
        <ChoiceGroup
          legend="Method"
          columns={3}
          value={method}
          onChange={setMethod}
          choices={[
            { value: 'telebirr', label: 'Telebirr' },
            { value: 'cbe_birr', label: 'CBE Birr' },
            { value: 'cash', label: 'Cash' },
          ]}
        />
        <TextField
          label="Reference (optional)"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          maxLength={60}
        />
        {settle.isError && !fields && <Notice tone="danger">{settle.error.message}</Notice>}
        <Button onClick={() => settle.mutate()} loading={settle.isPending} disabled={!amount}>
          Record settlement
        </Button>
      </Panel>
      <Panel className="p-4">
        <h2 className="mb-3 font-semibold">Ledger</h2>
        {ledger.isPending && <Skeleton className="h-32 w-full" />}
        <ul className="divide-y divide-line text-sm">
          {ledger.data?.entries.map((e) => (
            <li key={e.id} className="flex justify-between gap-3 py-2">
              <span>
                <span className="font-medium capitalize">{e.type}</span>
                {e.deliveryCode && <span className="text-ink-3"> · #{e.deliveryCode}</span>}
                {e.method && <span className="text-ink-3"> · {e.method.replace('_', ' ')}</span>}
                {e.reference && <span className="text-ink-3"> · ref {e.reference}</span>}
                <span className="block text-xs text-ink-3">{when(e.createdAt)}</span>
              </span>
              <span className={`tabular ${Number(e.amount) < 0 ? 'text-success' : ''}`}>
                {e.amount}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
