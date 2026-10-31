import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatPhone, type RiderApprovalStatus, type VehicleType } from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Notice,
  TextField,
  cn,
  useToast,
  type Tone,
} from '../../ui/index.ts';

interface AdminRider {
  userId: string;
  fullName: string | null;
  phone: string;
  vehicleType: VehicleType;
  plateNumber: string | null;
  approvalStatus: RiderApprovalStatus;
  rejectionReason: string | null;
  isOnline: boolean;
  locationUpdatedAt: string | null;
  createdAt: string;
}

type Decision = 'approve' | 'reject' | 'suspend' | 'reinstate';

const TABS: Array<{ value: RiderApprovalStatus | 'all'; label: string }> = [
  { value: 'pending', label: 'Applications' },
  { value: 'approved', label: 'Approved' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

const TONE: Record<RiderApprovalStatus, Tone> = {
  pending: 'warning',
  approved: 'success',
  suspended: 'danger',
  rejected: 'neutral',
};

const ACTIONS: Record<RiderApprovalStatus, Decision[]> = {
  pending: ['approve', 'reject'],
  approved: ['suspend'],
  suspended: ['reinstate'],
  rejected: ['approve'],
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export function RidersAdmin() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<RiderApprovalStatus | 'all'>('pending');
  const [pendingReason, setPendingReason] = useState<{
    rider: AdminRider;
    decision: Decision;
  } | null>(null);
  const [reason, setReason] = useState('');

  const list = useQuery({
    queryKey: ['admin', 'riders', tab],
    queryFn: () => api<AdminRider[]>(`/admin/riders${tab === 'all' ? '' : `?status=${tab}`}`),
    refetchInterval: 15_000,
  });

  const decide = useMutation({
    mutationFn: (v: { id: string; decision: Decision; reason?: string }) =>
      api(`/admin/riders/${v.id}/decision`, {
        method: 'POST',
        body: { decision: v.decision, reason: v.reason },
      }),
    onSuccess: (_d, v) => {
      toast(`Rider ${v.decision === 'approve' ? 'approved' : v.decision + 'ed'}.`, 'success');
      setPendingReason(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'riders'] });
    },
  });

  const act = (rider: AdminRider, decision: Decision) => {
    if (decision === 'reject' || decision === 'suspend') setPendingReason({ rider, decision });
    else decide.mutate({ id: rider.userId, decision });
  };

  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Riders</h1>
        <p className="text-ink-2">Review applications and manage who can receive jobs.</p>
      </div>

      <div role="tablist" className="flex flex-wrap gap-1 rounded-xl bg-surface-2 p-1 self-start">
        {TABS.map((x) => (
          <button
            key={x.value}
            role="tab"
            aria-selected={tab === x.value}
            onClick={() => setTab(x.value)}
            className={cn(
              'h-9 rounded-lg px-3 text-sm font-semibold',
              tab === x.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink',
            )}
          >
            {x.label}
          </button>
        ))}
      </div>

      {pendingReason && (
        <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
          <p className="font-semibold">
            {pendingReason.decision === 'reject' ? 'Reject' : 'Suspend'}{' '}
            {pendingReason.rider.fullName ?? formatPhone(pendingReason.rider.phone)}
          </p>
          <TextField
            label="Reason (shown to the rider)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            autoFocus
            error={
              decide.error instanceof ApiRequestError ? decide.error.fields?.reason : undefined
            }
          />
          <div className="flex gap-2">
            <Button
              variant="danger"
              loading={decide.isPending}
              disabled={reason.trim().length < 3}
              onClick={() =>
                decide.mutate({
                  id: pendingReason.rider.userId,
                  decision: pendingReason.decision,
                  reason,
                })
              }
            >
              Confirm
            </Button>
            <Button variant="ghost" onClick={() => setPendingReason(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {decide.isError && !pendingReason && <Notice tone="danger">{decide.error.message}</Notice>}

      <DataTable<AdminRider>
        caption="Riders"
        rows={list.data ?? []}
        loading={list.isPending}
        rowKey={(r) => r.userId}
        empty={
          <EmptyState
            title={tab === 'pending' ? 'No applications waiting' : 'No riders here'}
            body={tab === 'pending' ? 'New rider applications appear here for review.' : undefined}
          />
        }
        columns={[
          {
            key: 'name',
            header: 'Rider',
            cell: (r) => (
              <div>
                <p className="font-semibold">{r.fullName ?? '—'}</p>
                <p className="text-xs text-ink-3 tabular">{formatPhone(r.phone)}</p>
              </div>
            ),
          },
          {
            key: 'vehicle',
            header: 'Vehicle',
            cell: (r) => (r.vehicleType === 'motorcycle' ? 'Motorcycle' : 'Bicycle'),
          },
          {
            key: 'plate',
            header: 'Plate',
            cell: (r) => <span className="font-mono">{r.plateNumber ?? '—'}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <div className="flex flex-col gap-1">
                <Badge tone={TONE[r.approvalStatus]} dot>
                  {r.approvalStatus}
                </Badge>
                {r.approvalStatus === 'approved' && (
                  <span className={cn('text-xs', r.isOnline ? 'text-success' : 'text-ink-3')}>
                    {r.isOnline ? 'Online' : 'Offline'}
                  </span>
                )}
              </div>
            ),
          },
          {
            key: 'applied',
            header: 'Applied',
            cell: (r) => <span className="text-ink-2 tabular">{fmt(r.createdAt)}</span>,
          },
          {
            key: 'actions',
            header: 'Actions',
            hideHeader: true,
            align: 'right',
            cell: (r) => (
              <div className="flex justify-end gap-2">
                {ACTIONS[r.approvalStatus].map((d) => (
                  <Button
                    key={d}
                    variant={d === 'approve' || d === 'reinstate' ? 'primary' : 'secondary'}
                    onClick={() => act(r, d)}
                    disabled={decide.isPending}
                    className="h-9 px-3 text-sm"
                  >
                    {d[0]!.toUpperCase() + d.slice(1)}
                  </Button>
                ))}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
