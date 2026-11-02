import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronLeft, ShieldAlert } from 'lucide-react';
import {
  formatPhone,
  type AdminKycDetail,
  type AdminKycRow,
  type KycDocumentKind,
  type KycStatus,
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
  cn,
  useToast,
} from '../../ui/index.ts';

const STATUS_TONE: Record<KycStatus, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  not_submitted: 'neutral',
  pending_review: 'info',
  approved: 'success',
  rejected: 'danger',
  resubmission_required: 'warning',
};
const STATUS_LABEL: Record<KycStatus, string> = {
  not_submitted: 'Not submitted',
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  resubmission_required: 'Retakes requested',
};
const KIND_LABEL: Record<KycDocumentKind, string> = {
  license: "Driver's licence",
  plate: 'Number plate',
  id_front: 'National ID — front',
  id_back: 'National ID — back',
  face_front: 'Face — straight',
  face_left: 'Face — left',
  face_right: 'Face — right',
};

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/** Identity verification queue. Submitted applications first. */
export function KycAdmin() {
  const { id } = useParams();
  return id ? <KycReview id={id} /> : <KycQueue />;
}

function KycQueue() {
  const [status, setStatus] = useState<KycStatus>('pending_review');
  const list = useQuery({
    queryKey: ['admin', 'kyc', status],
    queryFn: () => api<AdminKycRow[]>(`/admin/kyc?status=${status}`),
  });
  const navigate = useNavigate();
  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-bold tracking-tight">Rider verification</h1>
        <p className="text-[15px] text-ink-2">
          Compare each rider's documents with their face photos. Riders can only take jobs once
          approved here.
        </p>
      </div>
      <Segmented
        label="Filter by status"
        className="max-w-2xl"
        value={status}
        onChange={setStatus}
        options={(
          [
            'pending_review',
            'resubmission_required',
            'rejected',
            'approved',
            'not_submitted',
          ] as const
        ).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
      />
      <DataTable<AdminKycRow>
        caption="Riders"
        rows={list.data ?? []}
        loading={list.isPending}
        rowKey={(r) => r.userId}
        onRowClick={(r) => navigate(`/admin/verification/${r.userId}`)}
        empty={<EmptyState title="Nothing here" body="No riders with this status." />}
        columns={[
          {
            key: 'name',
            header: 'Rider',
            cell: (r) => (
              <span className="min-w-0">
                <span className="block font-semibold">{r.fullName ?? '—'}</span>
                <span className="block text-xs text-ink-3 tabular">{formatPhone(r.phone)}</span>
              </span>
            ),
          },
          {
            key: 'vehicle',
            header: 'Vehicle',
            cell: (r) => (
              <span className="capitalize">
                {r.vehicleType}
                {r.plateNumber ? ` · ${r.plateNumber}` : ''}
              </span>
            ),
          },
          { key: 'submitted', header: 'Submitted', cell: (r) => when(r.submittedAt) },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <Badge tone={STATUS_TONE[r.kycStatus]} dot>
                {STATUS_LABEL[r.kycStatus]}
              </Badge>
            ),
          },
        ]}
      />
    </div>
  );
}

function KycReview({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const detail = useQuery({
    queryKey: ['admin', 'kyc', 'detail', id],
    queryFn: () => api<AdminKycDetail>(`/admin/riders/${id}/kyc`),
    // Each open is recorded in the audit log; don't re-fetch behind the reviewer's back.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const [mode, setMode] = useState<'none' | 'reject' | 'resubmit'>('none');
  const [reason, setReason] = useState('');
  const [retake, setRetake] = useState<KycDocumentKind[]>([]);
  const [zoom, setZoom] = useState<KycDocumentKind | null>(null);

  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject' | 'resubmit') =>
      api(`/admin/riders/${id}/kyc/decision`, {
        method: 'POST',
        body: {
          decision,
          ...(decision !== 'approve' ? { reason } : {}),
          ...(decision === 'resubmit' ? { retake } : {}),
        },
      }),
    onSuccess: (_d, decision) => {
      toast(
        decision === 'approve'
          ? 'Rider verified and approved. They can now go online.'
          : decision === 'reject'
            ? 'Application rejected. The photos were deleted; the rider can apply again.'
            : 'Retakes requested from the rider.',
        'success',
      );
      void queryClient.invalidateQueries({ queryKey: ['admin', 'kyc'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'riders'] });
      navigate('/admin/verification');
    },
  });
  const fields = decide.error instanceof ApiRequestError ? decide.error.fields : undefined;

  if (detail.isPending) return <Skeleton className="h-96 max-w-6xl" />;
  if (detail.isError) return <Notice tone="danger">{detail.error.message}</Notice>;
  const d = detail.data;
  const reviewable = d.kycStatus === 'pending_review';
  const img = (kind: KycDocumentKind) => `/api/admin/riders/${id}/kyc/${kind}`;
  const have = new Map(d.captured.map((c) => [c.kind, c]));

  return (
    <div className="flex max-w-6xl flex-col gap-5">
      <Link
        to="/admin/verification"
        className="flex items-center gap-1 text-sm font-semibold text-accent"
      >
        <ChevronLeft className="size-4" aria-hidden /> All applications
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">{d.fullName ?? 'Unnamed rider'}</h1>
          <p className="text-[15px] text-ink-2 tabular">{formatPhone(d.phone)}</p>
        </div>
        <Badge tone={STATUS_TONE[d.kycStatus]} dot>
          {STATUS_LABEL[d.kycStatus]}
        </Badge>
      </div>

      <Panel className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm md:grid-cols-4">
        <Fact
          label="Vehicle"
          value={`${d.vehicleType}${d.plateNumber ? ` · ${d.plateNumber}` : ''}`}
        />
        <Fact label="Account created" value={when(d.accountCreatedAt)} />
        <Fact label="Submitted" value={when(d.submittedAt)} />
        <Fact label="Last decision" value={when(d.reviewedAt)} />
      </Panel>

      <Notice tone="info">
        <span className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Photos were taken with the rider's live camera in the app, but nothing here is checked
          automatically. Check that the documents look genuine and readable, the details match, and
          the three face photos are the same person as the ID photo.
        </span>
      </Notice>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {d.required.map((kind) => {
          const cap = have.get(kind);
          const picked = retake.includes(kind);
          return (
            <figure key={kind} className="flex flex-col gap-2">
              <button
                type="button"
                disabled={!cap}
                onClick={() => setZoom(kind)}
                className={cn(
                  'aspect-[4/3] overflow-hidden rounded-[var(--radius-lg)] border bg-surface-2',
                  picked ? 'border-warning ring-2 ring-warning/40' : 'border-line',
                )}
              >
                {cap ? (
                  <img
                    src={img(kind)}
                    alt={KIND_LABEL[kind]}
                    className="size-full object-contain"
                  />
                ) : (
                  <span className="text-sm text-ink-3">Not provided</span>
                )}
              </button>
              <figcaption className="text-sm">
                <span className="block font-semibold">{KIND_LABEL[kind]}</span>
                {cap && (
                  <span className="block text-xs text-ink-3">
                    Taken {when(cap.capturedAt ?? cap.uploadedAt)}
                  </span>
                )}
              </figcaption>
              {reviewable && mode === 'resubmit' && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--c-accent)]"
                    checked={picked}
                    onChange={(e) =>
                      setRetake((r) =>
                        e.target.checked ? [...r, kind] : r.filter((k) => k !== kind),
                      )
                    }
                  />
                  Ask to retake
                </label>
              )}
            </figure>
          );
        })}
      </div>

      {reviewable ? (
        <Panel className="flex flex-col gap-4 p-5">
          <h2 className="text-lg font-semibold">Decision</h2>
          {mode !== 'none' && (
            <TextField
              label={
                mode === 'reject'
                  ? 'Reason for rejection (the rider sees this)'
                  : 'What should the rider fix? (they see this)'
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              error={fields?.reason}
              maxLength={300}
              autoFocus
            />
          )}
          {fields?.retake && <Notice tone="danger">{fields.retake}</Notice>}
          {decide.isError && !fields && <Notice tone="danger">{decide.error.message}</Notice>}
          <div className="flex flex-wrap gap-2">
            {mode === 'none' && (
              <>
                <Button onClick={() => decide.mutate('approve')} loading={decide.isPending}>
                  Approve rider
                </Button>
                <Button variant="secondary" onClick={() => setMode('resubmit')}>
                  Ask for retakes
                </Button>
                <Button variant="danger-soft" onClick={() => setMode('reject')}>
                  Reject
                </Button>
              </>
            )}
            {mode === 'resubmit' && (
              <Button
                onClick={() => decide.mutate('resubmit')}
                loading={decide.isPending}
                disabled={!retake.length || reason.trim().length < 3}
              >
                Request {retake.length || ''} retake{retake.length === 1 ? '' : 's'}
              </Button>
            )}
            {mode === 'reject' && (
              <Button
                variant="danger"
                onClick={() => decide.mutate('reject')}
                loading={decide.isPending}
                disabled={reason.trim().length < 3}
              >
                Reject application
              </Button>
            )}
            {mode !== 'none' && (
              <Button
                variant="ghost"
                onClick={() => {
                  setMode('none');
                  setRetake([]);
                  decide.reset();
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </Panel>
      ) : (
        d.reason && (
          <Notice tone="warning">
            <span className="font-semibold">Last message to rider:</span> {d.reason}
          </Notice>
        )
      )}

      {d.history.length > 0 && (
        <Panel className="p-4">
          <h2 className="mb-2 font-semibold">History</h2>
          <ul className="divide-y divide-line text-sm">
            {d.history.map((h, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{h.action.replace('kyc.', '')}</span>
                  {h.by ? ` by ${h.by}` : ''}
                  {h.reason ? ` — “${h.reason}”` : ''}
                </span>
                <span className="text-ink-3">{when(h.at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {zoom && (
        <button
          type="button"
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
          aria-label="Close photo"
        >
          <img
            src={img(zoom)}
            alt={KIND_LABEL[zoom]}
            className="max-h-full max-w-full object-contain"
          />
        </button>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-3">{label}</p>
      <p className="font-medium capitalize">{value}</p>
    </div>
  );
}
