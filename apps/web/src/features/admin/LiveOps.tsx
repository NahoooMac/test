import { useQuery } from '@tanstack/react-query';
import { formatPhone } from '@dp/shared';
import { api } from '../../lib/api.ts';
import { pollEvery, useLiveConnected, type OpsSnapshot } from '../../lib/live.ts';
import { MapView, type MapMarker } from '../../map/MapView.tsx';
import { Badge, DataTable, EmptyState, Panel, cn, type Tone } from '../../ui/index.ts';
import { STATUS_TONE } from '../deliveries/status.ts';

const RIDER_STATE: Record<OpsSnapshot['riders'][number]['state'], { label: string; tone: Tone }> = {
  idle: { label: 'Available', tone: 'success' },
  offered: { label: 'Offer pending', tone: 'warning' },
  on_job: { label: 'On a job', tone: 'info' },
};

const STATUS_LABEL: Record<string, string> = {
  requested: 'Finding rider',
  assigned: 'Assigned',
  arrived_pickup: 'At pickup',
  picked_up: 'Picked up',
  arrived_dropoff: 'At drop-off',
  returning: 'Returning',
};

const waited = (sec: number) =>
  sec < 60
    ? `${sec}s`
    : sec < 3600
      ? `${Math.floor(sec / 60)} min`
      : `${Math.floor(sec / 3600)} h ${Math.floor((sec % 3600) / 60)} min`;

/** Live operations board: who is online where, and which deliveries need attention. */
export function LiveOps() {
  const live = useLiveConnected();
  const ops = useQuery({
    queryKey: ['admin', 'ops'],
    queryFn: () => api<OpsSnapshot>('/admin/ops'),
    // Waiting times also need to tick, so refresh at least every 30 s even when live.
    refetchInterval: () => pollEvery(10_000, 30_000),
  });

  const data = ops.data;
  const markers: MapMarker[] = [
    ...(data?.riders ?? [])
      .filter((r) => r.lat != null && r.lng != null)
      .map((r) => ({
        id: `r-${r.id}`,
        point: { lat: r.lat!, lng: r.lng! },
        kind: 'rider' as const,
        vehicleType: r.vehicleType,
      })),
    ...(data?.deliveries ?? [])
      .filter((d) => d.status === 'requested')
      .map((d) => ({ id: `p-${d.id}`, point: d.pickup, kind: 'pickup' as const })),
  ];
  const attention = data?.deliveries.filter((d) => d.needsAttention) ?? [];
  const counts = {
    online: data?.riders.filter((r) => r.isOnline).length ?? 0,
    available: data?.riders.filter((r) => r.state === 'idle' && r.isOnline).length ?? 0,
    waiting: data?.deliveries.filter((d) => d.status === 'requested').length ?? 0,
    active: data?.deliveries.filter((d) => d.status !== 'requested').length ?? 0,
  };

  return (
    <div className="flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Live operations</h1>
          <p className="text-ink-2">
            Riders on the road and deliveries in progress across Addis Ababa.
          </p>
        </div>
        <span
          className={cn(
            'flex items-center gap-2 text-sm font-medium',
            live ? 'text-success' : 'text-ink-3',
          )}
        >
          <span
            className={cn('size-2 rounded-full', live ? 'bg-success' : 'bg-ink-3')}
            aria-hidden
          />
          {live ? 'Live' : 'Reconnecting… (refreshing every 10 s)'}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(
          [
            ['Riders online', counts.online],
            ['Available now', counts.available],
            ['Waiting for a rider', counts.waiting],
            ['In progress', counts.active],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-line bg-surface px-4 py-3">
            <dt className="text-sm text-ink-3">{label}</dt>
            <dd className="text-2xl font-bold tabular">{ops.isPending ? '—' : value}</dd>
          </div>
        ))}
      </dl>

      {attention.length > 0 && (
        <div
          role="alert"
          className="rounded-2xl bg-warning-soft px-4 py-3 text-sm font-medium text-warning"
        >
          {attention.length} {attention.length === 1 ? 'delivery has' : 'deliveries have'} waited
          over 5 minutes for a rider: {attention.map((d) => `#${d.code}`).join(', ')}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel className="overflow-hidden">
          <MapView className="h-[420px]" zoom={12} markers={markers} />
          <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
            Green: motorcycles · Blue: bicycles · Rings: pickups waiting
          </p>
        </Panel>
        <Panel className="flex flex-col">
          <h2 className="border-b border-line px-4 py-3 font-semibold">Riders</h2>
          {data && data.riders.length === 0 && (
            <EmptyState title="No riders online" body="Riders appear here when they go online." />
          )}
          <ul className="divide-y divide-line overflow-y-auto" style={{ maxHeight: 380 }}>
            {data?.riders.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{r.name ?? formatPhone(r.phone)}</p>
                  <p className="text-xs text-ink-3">
                    {r.vehicleType === 'motorcycle' ? 'Motorcycle' : 'Bicycle'}
                    {r.plate ? ` · ${r.plate}` : ''}
                    {r.locationUpdatedAt
                      ? ` · GPS ${waited(Math.max(0, Math.floor((Date.now() - new Date(r.locationUpdatedAt).getTime()) / 1000)))} ago`
                      : ' · no GPS yet'}
                  </p>
                </div>
                <Badge tone={RIDER_STATE[r.state].tone} dot>
                  {RIDER_STATE[r.state].label}
                </Badge>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <DataTable
        caption="Open deliveries"
        rows={data?.deliveries ?? []}
        loading={ops.isPending}
        rowKey={(d) => d.id}
        empty={<EmptyState title="No open deliveries" body="New bookings appear here instantly." />}
        columns={[
          {
            key: 'code',
            header: 'Code',
            cell: (d) => <span className="font-mono font-semibold">#{d.code}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (d) => (
              <Badge tone={d.needsAttention ? 'danger' : STATUS_TONE[d.status]} dot>
                {STATUS_LABEL[d.status] ?? d.status}
              </Badge>
            ),
          },
          {
            key: 'route',
            header: 'Route',
            cell: (d) => (
              <span className="text-ink-2">
                {d.pickup.address} → {d.dropoff.address}
              </span>
            ),
          },
          {
            key: 'vehicle',
            header: 'Vehicle',
            cell: (d) => (d.vehicleType === 'motorcycle' ? 'Motorcycle' : 'Bicycle'),
          },
          {
            key: 'rider',
            header: 'Rider',
            cell: (d) => d.riderName ?? <span className="text-ink-3">—</span>,
          },
          {
            key: 'age',
            header: 'Booked',
            align: 'right',
            cell: (d) => (
              <span className={cn(d.needsAttention && 'font-semibold text-danger')}>
                {waited(d.waitingSec)} ago
              </span>
            ),
          },
          { key: 'fare', header: 'Fare (ETB)', align: 'right', cell: (d) => d.fare },
        ]}
      />
    </div>
  );
}
