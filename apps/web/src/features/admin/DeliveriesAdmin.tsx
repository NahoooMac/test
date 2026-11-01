import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import {
  DELIVERY_STATUSES,
  formatPhone,
  type DeliveryStatus,
  type PaymentMethod,
} from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Notice,
  Panel,
  Skeleton,
  TextField,
  Timeline,
  cn,
  useToast,
} from '../../ui/index.ts';
import { STATUS_TONE } from '../deliveries/status.ts';

interface Row {
  id: string;
  code: string;
  status: DeliveryStatus;
  vehicleType: 'motorcycle' | 'bicycle';
  pickup: string;
  dropoff: string;
  customerName: string | null;
  customerPhone: string;
  riderName: string | null;
  fare: string;
  fareStatus: 'due' | 'collected' | 'waived' | null;
  createdAt: string;
}

interface Detail {
  id: string;
  code: string;
  status: DeliveryStatus;
  vehicleType: 'motorcycle' | 'bicycle';
  payer: 'sender' | 'receiver';
  preferredPaymentMethod: PaymentMethod;
  customer: { phone: string; name: string | null };
  rider: { id: string; phone: string; name: string | null; plate: string | null } | null;
  pickup: { address: string; contactName: string; contactPhone: string; notes: string };
  dropoff: { address: string; contactName: string; contactPhone: string; notes: string };
  parcel: { description: string; size: string };
  money: {
    fare: string;
    commissionRate: string;
    commission: string;
    riderEarning: string;
    cancellationFee: string;
  };
  distanceKm: number;
  dispatchRound: number;
  cancelReason: string | null;
  createdAt: string;
  events: Array<{ id: string; to: DeliveryStatus; actor: string; note: string | null; at: string }>;
  offers: Array<{
    id: string;
    riderName: string | null;
    status: string;
    round: number;
    toPickupKm: number;
    offeredAt: string;
  }>;
  payments: Array<{
    id: string;
    kind: string;
    status: 'due' | 'collected' | 'waived';
    amount: string;
    method: PaymentMethod | null;
    reference: string | null;
    collectedAt: string | null;
  }>;
  contactAttempts: Array<{ outcome: string; at: string }>;
  audit: Array<{
    id: string;
    action: string;
    actorName: string | null;
    createdAt: string;
    details: Record<string, unknown> | null;
  }>;
}

const label = (s: string) => s.replace(/_/g, ' ');
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export function DeliveriesAdmin() {
  const { id } = useParams();
  return id ? <DeliveryDetailAdmin id={id} /> : <DeliveryListAdmin />;
}

function DeliveryListAdmin() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<DeliveryStatus | ''>('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const list = useQuery({
    queryKey: ['admin', 'deliveries', status, query],
    queryFn: () => {
      const p = new URLSearchParams();
      if (status) p.set('status', status);
      if (query) p.set('q', query);
      return api<Row[]>(`/admin/deliveries?${p}`);
    },
  });

  return (
    <div className="flex max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">Deliveries</h1>
        <p className="text-[15px] text-ink-2">
          Search by code, customer name or phone. Open a delivery to assign, re-offer or cancel it.
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <TextField
          label="Search"
          className="w-72"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Code, name or phone"
        />
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as DeliveryStatus | '')}
            className="h-14 rounded-[var(--radius-lg)] border border-line-strong bg-surface px-3 text-base shadow-[var(--shadow-xs)] transition-shadow duration-[var(--dur-fast)] focus:shadow-[var(--shadow-sm)]"
          >
            <option value="">All</option>
            {DELIVERY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" className="h-14">
          Search
        </Button>
      </form>
      <DataTable<Row>
        caption="Deliveries"
        rows={list.data ?? []}
        loading={list.isPending}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/admin/deliveries/${r.id}`)}
        empty={<EmptyState title="No deliveries match" />}
        columns={[
          {
            key: 'code',
            header: 'Code',
            cell: (r) => <span className="font-mono font-semibold">#{r.code}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <Badge tone={STATUS_TONE[r.status]} dot>
                {label(r.status)}
              </Badge>
            ),
          },
          {
            key: 'route',
            header: 'Route',
            cell: (r) => (
              <span className="text-ink-2">
                {r.pickup} → {r.dropoff}
              </span>
            ),
          },
          {
            key: 'customer',
            header: 'Customer',
            cell: (r) => r.customerName ?? formatPhone(r.customerPhone),
          },
          {
            key: 'rider',
            header: 'Rider',
            cell: (r) => r.riderName ?? <span className="text-ink-3">—</span>,
          },
          {
            key: 'paid',
            header: 'Fare paid',
            cell: (r) =>
              r.fareStatus === 'collected' ? (
                <Badge tone="success">paid</Badge>
              ) : (
                <span className="text-ink-3">—</span>
              ),
          },
          { key: 'fare', header: 'Fare (ETB)', align: 'right', cell: (r) => r.fare },
          {
            key: 'when',
            header: 'Booked',
            align: 'right',
            cell: (r) => <span className="text-ink-2">{when(r.createdAt)}</span>,
          },
        ]}
      />
    </div>
  );
}

function DeliveryDetailAdmin({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const detail = useQuery({
    queryKey: ['admin', 'delivery', id],
    queryFn: () => api<Detail>(`/admin/deliveries/${id}`),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin'] });
  };
  const [panel, setPanel] = useState<'assign' | 'cancel' | null>(null);

  const redispatch = useMutation({
    mutationFn: () =>
      api<{ result: string }>(`/admin/deliveries/${id}/redispatch`, { method: 'POST' }),
    onSuccess: (r) => {
      toast(
        r.result === 'offered'
          ? 'Offered to the nearest rider.'
          : 'No rider available right now; it will keep trying.',
        r.result === 'offered' ? 'success' : 'info',
      );
      refresh();
    },
  });

  if (detail.isPending) return <Skeleton className="h-96 w-full max-w-5xl" />;
  if (detail.isError)
    return <ErrorState title="Could not load this delivery" body={detail.error.message} />;
  const d = detail.data;
  const waiting = d.status === 'requested';
  const cancellable = ['requested', 'assigned', 'arrived_pickup'].includes(d.status);

  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <Link
        to="/admin/deliveries"
        className="flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink"
      >
        <ChevronLeft className="size-4" aria-hidden /> All deliveries
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-[26px] font-bold tracking-tight">#{d.code}</h1>
          <p className="text-ink-2">
            {d.vehicleType === 'motorcycle' ? 'Motorcycle' : 'Bicycle'} · {d.distanceKm.toFixed(1)}{' '}
            km · booked {when(d.createdAt)}
            {d.dispatchRound > 0 && ` · dispatch round ${d.dispatchRound + 1}`}
          </p>
        </div>
        <Badge tone={STATUS_TONE[d.status]} dot className="h-8 px-3 text-sm">
          {label(d.status)}
        </Badge>
      </div>

      {(waiting || cancellable) && (
        <div className="flex flex-wrap gap-2">
          {waiting && (
            <Button onClick={() => setPanel(panel === 'assign' ? null : 'assign')}>
              Assign a rider
            </Button>
          )}
          {waiting && (
            <Button
              variant="secondary"
              onClick={() => redispatch.mutate()}
              loading={redispatch.isPending}
            >
              Re-offer to all riders
            </Button>
          )}
          {cancellable && (
            <Button
              variant="danger-soft"
              onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}
            >
              Cancel delivery
            </Button>
          )}
        </div>
      )}
      {redispatch.isError && <Notice tone="danger">{redispatch.error.message}</Notice>}
      {panel === 'assign' && (
        <AssignPanel
          id={id}
          vehicle={d.vehicleType}
          onDone={() => {
            setPanel(null);
            refresh();
          }}
        />
      )}
      {panel === 'cancel' && (
        <CancelPanel
          id={id}
          afterArrival={d.status === 'arrived_pickup'}
          onDone={() => {
            setPanel(null);
            refresh();
          }}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel className="flex flex-col gap-3 p-4">
          <h2 className="font-semibold">People</h2>
          <Field k="Customer" v={`${d.customer.name ?? '—'} · ${formatPhone(d.customer.phone)}`} />
          <Field
            k="Rider"
            v={
              d.rider
                ? `${d.rider.name ?? '—'} · ${formatPhone(d.rider.phone)}${d.rider.plate ? ` · ${d.rider.plate}` : ''}`
                : '—'
            }
          />
          <Field
            k="Pickup"
            v={`${d.pickup.address} — ${d.pickup.contactName}, ${formatPhone(d.pickup.contactPhone)}${d.pickup.notes ? ` (“${d.pickup.notes}”)` : ''}`}
          />
          <Field
            k="Drop-off"
            v={`${d.dropoff.address} — ${d.dropoff.contactName}, ${formatPhone(d.dropoff.contactPhone)}${d.dropoff.notes ? ` (“${d.dropoff.notes}”)` : ''}`}
          />
          <Field k="Parcel" v={`${d.parcel.description} · ${d.parcel.size}`} />
          {d.cancelReason && <Field k="Cancel reason" v={d.cancelReason} />}
        </Panel>
        <Panel className="flex flex-col gap-3 p-4">
          <h2 className="font-semibold">Money</h2>
          <Field
            k="Fare"
            v={`${d.money.fare} ETB · paid by ${d.payer} (prefers ${label(d.preferredPaymentMethod)})`}
          />
          <Field
            k="Commission"
            v={`${d.money.commission} ETB (${(Number(d.money.commissionRate) * 100).toFixed(0)}%)`}
          />
          <Field k="Rider earns" v={`${d.money.riderEarning} ETB`} />
          {d.money.cancellationFee !== '0.00' && (
            <Field k="Cancellation fee" v={`${d.money.cancellationFee} ETB (all to the rider)`} />
          )}
          <h3 className="mt-2 text-sm font-semibold text-ink-3 uppercase">Payments</h3>
          {d.payments.length === 0 && <p className="text-sm text-ink-3">Nothing recorded yet.</p>}
          {d.payments.map((p) => (
            <PaymentRow key={p.id} p={p} onDone={refresh} />
          ))}
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel className="p-4">
          <h2 className="mb-3 font-semibold">Status history</h2>
          <Timeline
            items={d.events.map((e) => ({
              id: e.id,
              title: label(e.to),
              detail: `${e.actor}${e.note ? ` · ${e.note}` : ''}`,
              time: when(e.at),
              state: 'done' as const,
            }))}
          />
        </Panel>
        <Panel className="p-4">
          <h2 className="mb-3 font-semibold">Offers</h2>
          {d.offers.length === 0 && (
            <p className="text-sm text-ink-3">No rider has been offered this job.</p>
          )}
          <ul className="flex flex-col gap-2 text-sm">
            {d.offers.map((o) => (
              <li key={o.id} className="flex justify-between gap-3">
                <span>
                  {o.riderName ?? '—'}{' '}
                  <span className="text-ink-3">
                    · {o.toPickupKm.toFixed(1)} km · round {o.round + 1}
                  </span>
                </span>
                <Badge
                  tone={
                    o.status === 'accepted'
                      ? 'success'
                      : o.status === 'offered'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {o.status}
                </Badge>
              </li>
            ))}
          </ul>
          {d.contactAttempts.length > 0 && (
            <>
              <h3 className="mt-4 mb-2 text-sm font-semibold text-ink-3 uppercase">
                Calls to receiver
              </h3>
              <ul className="text-sm">
                {d.contactAttempts.map((a, i) => (
                  <li key={i}>
                    {label(a.outcome)} · {when(a.at)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
        <Panel className="p-4">
          <h2 className="mb-3 font-semibold">Admin actions</h2>
          {d.audit.length === 0 && <p className="text-sm text-ink-3">None.</p>}
          <ul className="flex flex-col gap-2 text-sm">
            {d.audit.map((a) => (
              <li key={a.id}>
                <span className="font-medium">{label(a.action.replace('.', ' · '))}</span>
                <span className="text-ink-3">
                  {' '}
                  · {a.actorName ?? 'admin'} · {when(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 text-sm">
      <span className="text-ink-3">{k}</span>
      <span>{v}</span>
    </div>
  );
}

function PaymentRow({ p, onDone }: { p: Detail['payments'][number]; onDone: () => void }) {
  const toast = useToast();
  const resolve = useMutation({
    mutationFn: (body: { status: 'collected' | 'waived'; method?: PaymentMethod }) =>
      api(`/admin/payments/${p.id}/resolve`, { method: 'POST', body }),
    onSuccess: () => {
      toast('Payment updated.', 'success');
      onDone();
    },
  });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
      <span>
        <span className="font-medium">{label(p.kind)}</span> · {p.amount} ETB
        {p.method && ` · ${label(p.method)}`}
        {p.reference && ` · ref ${p.reference}`}
      </span>
      <span className="flex items-center gap-2">
        <Badge
          tone={p.status === 'collected' ? 'success' : p.status === 'due' ? 'warning' : 'neutral'}
        >
          {p.status}
        </Badge>
        {p.status === 'due' && (
          <>
            <Button
              className="h-8 px-2 text-xs"
              onClick={() => resolve.mutate({ status: 'collected', method: 'cash' })}
              loading={resolve.isPending}
            >
              Mark collected (cash)
            </Button>
            <Button
              variant="ghost"
              className="h-8 px-2 text-xs"
              onClick={() => resolve.mutate({ status: 'waived' })}
            >
              Waive
            </Button>
          </>
        )}
      </span>
    </div>
  );
}

function AssignPanel({
  id,
  vehicle,
  onDone,
}: {
  id: string;
  vehicle: 'motorcycle' | 'bicycle';
  onDone: () => void;
}) {
  const toast = useToast();
  const available = useQuery({
    queryKey: ['admin', 'riders', 'available'],
    queryFn: () =>
      api<
        Array<{
          id: string;
          name: string | null;
          phone: string;
          vehicleType: string;
          plate: string | null;
          isOnline: boolean;
        }>
      >('/admin/riders/available'),
  });
  const assign = useMutation({
    mutationFn: (riderId: string) =>
      api(`/admin/deliveries/${id}/assign`, { method: 'POST', body: { riderId } }),
    onSuccess: () => {
      toast('Rider assigned.', 'success');
      onDone();
    },
  });
  const riders = available.data?.filter((r) => r.vehicleType === vehicle) ?? [];
  return (
    <Panel className="p-4">
      <h2 className="mb-1 font-semibold">Assign a rider</h2>
      <p className="mb-3 text-sm text-ink-2">
        Approved {vehicle} riders without an active job. Online riders first.
      </p>
      {assign.isError && (
        <Notice tone="danger" className="mb-3">
          {assign.error.message}
        </Notice>
      )}
      {available.isPending && <Skeleton className="h-16 w-full" />}
      {available.data && riders.length === 0 && (
        <p className="text-sm text-ink-3">No free {vehicle} riders.</p>
      )}
      <ul className="divide-y divide-line">
        {riders.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm">
              <span className="font-semibold">{r.name ?? formatPhone(r.phone)}</span>
              <span className="text-ink-3">{r.plate ? ` · ${r.plate}` : ''} · </span>
              <span className={cn(r.isOnline ? 'text-success' : 'text-ink-3')}>
                {r.isOnline ? 'online' : 'offline'}
              </span>
            </span>
            <Button
              className="h-9 px-3 text-sm"
              onClick={() => assign.mutate(r.id)}
              loading={assign.isPending && assign.variables === r.id}
            >
              Assign
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CancelPanel({
  id,
  afterArrival,
  onDone,
}: {
  id: string;
  afterArrival: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [chargeFee, setChargeFee] = useState(false);
  const cancel = useMutation({
    mutationFn: () =>
      api(`/admin/deliveries/${id}/cancel`, { method: 'POST', body: { reason, chargeFee } }),
    onSuccess: () => {
      toast('Delivery cancelled.', 'success');
      onDone();
    },
  });
  const fieldError =
    cancel.error instanceof ApiRequestError ? cancel.error.fields?.reason : undefined;
  return (
    <Panel className="flex flex-col gap-3 p-4">
      <h2 className="font-semibold">Cancel this delivery</h2>
      <TextField
        label="Reason (kept in the audit log)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={fieldError}
        maxLength={200}
      />
      {afterArrival && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={chargeFee}
            onChange={(e) => setChargeFee(e.target.checked)}
            className="size-4"
          />
          The rider already reached the pickup — charge the cancellation fee (all of it goes to the
          rider)
        </label>
      )}
      {cancel.isError && !fieldError && <Notice tone="danger">{cancel.error.message}</Notice>}
      <div>
        <Button
          variant="danger"
          onClick={() => cancel.mutate()}
          loading={cancel.isPending}
          disabled={reason.trim().length < 3}
        >
          Confirm cancellation
        </Button>
      </div>
    </Panel>
  );
}
