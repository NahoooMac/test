import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { VehicleType } from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import {
  Badge,
  Button,
  DataTable,
  Notice,
  Panel,
  Skeleton,
  TextField,
  useToast,
} from '../../ui/index.ts';
import { vehicleLabel } from '../deliveries/status.ts';

interface Rule {
  id: string;
  vehicleType: VehicleType;
  baseFare: string;
  perKm: string;
  minimumFare: string;
  maxDistanceKm: number | null;
  commissionRate: string;
  cancellationFeeAfterArrival: string;
  perMinute: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  current: boolean;
  createdBy: string | null;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Versioned rates: saving creates a new rule for new bookings; past deliveries keep theirs. */
export function PricingAdmin() {
  const rules = useQuery({
    queryKey: ['admin', 'pricing'],
    queryFn: () => api<Rule[]>('/admin/pricing'),
  });
  const current = (v: VehicleType) => rules.data?.find((r) => r.vehicleType === v && r.current);

  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">Pricing</h1>
        <p className="text-[15px] text-ink-2">
          Fare = max(minimum, base + per-km × distance), rounded up to the next 5 ETB. Changes apply
          to new bookings immediately; existing deliveries keep the rates they were booked with.
        </p>
      </div>
      {rules.isPending ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {(['motorcycle', 'bicycle'] as const).map((v) => {
            const rule = current(v);
            return rule ? <RuleForm key={`${v}-${rule.id}`} rule={rule} /> : null;
          })}
        </div>
      )}
      <h2 className="mt-2 text-lg font-semibold">History</h2>
      <DataTable<Rule>
        caption="Pricing history"
        rows={rules.data ?? []}
        loading={rules.isPending}
        rowKey={(r) => r.id}
        columns={[
          {
            key: 'v',
            header: 'Vehicle',
            cell: (r) => vehicleLabel(r.vehicleType),
          },
          { key: 'base', header: 'Base', align: 'right', cell: (r) => r.baseFare },
          { key: 'km', header: 'Per km', align: 'right', cell: (r) => r.perKm },
          { key: 'min', header: 'Minimum', align: 'right', cell: (r) => r.minimumFare },
          { key: 'max', header: 'Max km', align: 'right', cell: (r) => r.maxDistanceKm ?? '—' },
          {
            key: 'comm',
            header: 'Commission',
            align: 'right',
            cell: (r) => `${(Number(r.commissionRate) * 100).toFixed(1)}%`,
          },
          {
            key: 'fee',
            header: 'Cancel fee',
            align: 'right',
            cell: (r) => r.cancellationFeeAfterArrival,
          },
          {
            key: 'from',
            header: 'Effective',
            cell: (r) => (
              <span className="text-ink-2">
                {when(r.effectiveFrom)}
                {r.effectiveTo ? ` → ${when(r.effectiveTo)}` : ''}
              </span>
            ),
          },
          {
            key: 'state',
            header: 'Status',
            hideHeader: true,
            cell: (r) => (r.current ? <Badge tone="success">current</Badge> : null),
          },
          {
            key: 'by',
            header: 'Set by',
            cell: (r) => r.createdBy ?? <span className="text-ink-3">seed</span>,
          },
        ]}
      />
    </div>
  );
}

function RuleForm({ rule }: { rule: Rule }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    baseFare: rule.baseFare,
    perKm: rule.perKm,
    minimumFare: rule.minimumFare,
    maxDistanceKm: rule.maxDistanceKm?.toString() ?? '',
    commissionPct: (Number(rule.commissionRate) * 100).toString(),
    cancellationFeeAfterArrival: rule.cancellationFeeAfterArrival,
    perMinute: rule.perMinute ?? '0.00',
  });
  const save = useMutation({
    mutationFn: () =>
      api('/admin/pricing', {
        method: 'POST',
        body: {
          vehicleType: rule.vehicleType,
          baseFare: f.baseFare,
          perKm: f.perKm,
          minimumFare: f.minimumFare,
          maxDistanceKm: f.maxDistanceKm ? Number(f.maxDistanceKm) : null,
          commissionRate: Number(f.commissionPct) / 100,
          cancellationFeeAfterArrival: f.cancellationFeeAfterArrival,
          perMinute: f.perMinute,
        },
      }),
    onSuccess: () => {
      toast('New rates saved. They apply to new bookings now.', 'success');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'pricing'] });
    },
  });
  const fields = save.error instanceof ApiRequestError ? save.error.fields : undefined;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <Panel className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {vehicleLabel(rule.vehicleType)}
        </h2>
        <span className="text-xs text-ink-3">since {when(rule.effectiveFrom)}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Base fare (ETB)"
          inputMode="decimal"
          value={f.baseFare}
          onChange={set('baseFare')}
          error={fields?.baseFare}
        />
        <TextField
          label="Per km (ETB)"
          inputMode="decimal"
          value={f.perKm}
          onChange={set('perKm')}
          error={fields?.perKm}
        />
        <TextField
          label="Minimum fare (ETB)"
          inputMode="decimal"
          value={f.minimumFare}
          onChange={set('minimumFare')}
          error={fields?.minimumFare}
        />
        <TextField
          label="Max distance (km)"
          hint="Empty = no limit"
          inputMode="decimal"
          value={f.maxDistanceKm}
          onChange={set('maxDistanceKm')}
          error={fields?.maxDistanceKm}
        />
        <TextField
          label="Commission (%)"
          inputMode="decimal"
          value={f.commissionPct}
          onChange={set('commissionPct')}
          error={fields?.commissionRate}
        />
        <TextField
          label="Cancel fee after arrival (ETB)"
          inputMode="decimal"
          value={f.cancellationFeeAfterArrival}
          onChange={set('cancellationFeeAfterArrival')}
          error={fields?.cancellationFeeAfterArrival}
        />
        <TextField
          label="Per journey minute (ETB)"
          hint="Final fare: pickup → drop-off time. 0 = distance only"
          inputMode="decimal"
          value={f.perMinute}
          onChange={set('perMinute')}
          error={fields?.perMinute}
        />
      </div>
      {save.isError && !fields && <Notice tone="danger">{save.error.message}</Notice>}
      <div>
        <Button onClick={() => save.mutate()} loading={save.isPending}>
          Save new rates
        </Button>
      </div>
    </Panel>
  );
}
