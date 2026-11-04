// The rider's screen after "End delivery": final price, who pays, payment outcome, handover, Done.
// The amount always comes from the server (calculated from the actual route and journey time);
// nothing here can change it. "Show price to customer" turns the phone into a large price
// display, so a receiver without the app (or internet) can read the amount.
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CheckCircle2, Clock, MapPin, MonitorSmartphone, Phone, Route, Send } from 'lucide-react';
import { formatPhone, type PaymentMethod, type RiderJob } from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';
import { Badge, Button, ChoiceGroup, cn, Notice, Panel, TextField, useToast } from '../../ui/index.ts';
import { riderHomeKey } from './hooks.ts';
import { riderKeys, useRiderCopy } from './features.ts';

const methodLabel = (m: PaymentMethod) => (m === 'cash' ? 'Cash' : m === 'telebirr' ? 'Telebirr' : 'CBE Birr');
export const minutesLabel = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);

export function DestinationPayment({ job, unreachable }: { job: RiderJob; unreachable: ReactNode }) {
  const c = useRiderCopy();
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showing, setShowing] = useState(false);
  const [handover, setHandover] = useState(false);
  const f = job.finalFare!;
  const p = job.farePayment;
  const payer = job.payerContact;

  const finish = useMutation({
    mutationFn: () =>
      api<RiderJob>(`/rider/jobs/${job.id}/complete`, { method: 'POST', body: { handoverConfirmed: true } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: riderHomeKey });
      void qc.invalidateQueries({ queryKey: riderKeys.wallet });
      void qc.invalidateQueries({ queryKey: riderKeys.pool });
      navigate('/rider');
    },
  });
  const resend = useMutation({
    mutationFn: () => api<{ sent: boolean }>(`/rider/jobs/${job.id}/final-price/resend`, { method: 'POST' }),
    onSuccess: (r) => toast(r.sent ? c.pay.smsResent : t('errors.genericTitle'), r.sent ? 'success' : 'danger'),
    onSettled: () => qc.invalidateQueries({ queryKey: riderHomeKey }),
  });

  if (showing) return <PriceDisplay job={job} onBack={() => setShowing(false)} />;

  const canFinish = !!p && handover;
  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pt-5 pb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-ink-3 tabular">#{job.code}</p>
          <h1 className="text-[24px] font-bold tracking-tight">{t('rider.job.atDropoff')}</h1>
        </div>
        <Badge tone={payer.role === 'sender' ? 'info' : 'accent'}>
          {payer.role === 'sender' ? c.pay.sender : c.pay.receiver}
        </Badge>
      </div>

      {/* The price: large, read-only. */}
      <Panel className="overflow-hidden">
        <div className="bg-gradient-to-br from-accent to-accent-2 px-5 py-5 text-white">
          <p className="text-sm font-medium opacity-90">{c.pay.finalPrice}</p>
          <p className="text-[44px] leading-none font-extrabold tracking-tight tabular" aria-live="polite">
            {f.fare} <span className="text-xl font-bold opacity-90">ETB</span>
          </p>
          {f.estimatedFare !== f.fare && (
            <p className="mt-1 text-sm opacity-80 tabular">
              {c.pay.estimated}: {f.estimatedFare} ETB
            </p>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
          <div>
            <dt className="flex items-center gap-1 text-ink-3">
              <Route className="size-3.5" aria-hidden /> {c.pay.distance}
            </dt>
            <dd className="font-semibold tabular">{f.actualDistanceKm.toFixed(2)} km</dd>
            <dd className="text-xs text-ink-3">{f.basis === 'gps' ? c.pay.gps : c.pay.estimateBasis}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-ink-3">
              <Clock className="size-3.5" aria-hidden /> {c.pay.duration}
            </dt>
            <dd className="font-semibold tabular">{minutesLabel(f.actualDurationMin)}</dd>
          </div>
        </dl>
        <div className="px-4 pb-4">
          <Button
            block
            size="lg"
            variant="secondary"
            icon={<MonitorSmartphone className="size-5" aria-hidden />}
            onClick={() => setShowing(true)}
          >
            {c.pay.showCustomer}
          </Button>
        </div>
      </Panel>

      {/* Who pays, and how to reach them. */}
      <Panel className="p-4">
        <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">{c.pay.payer}</p>
        <p className="mt-0.5 text-lg font-bold">
          {payer.name ?? formatPhone(payer.phone)}{' '}
          <span className="text-sm font-medium text-ink-3">
            · {payer.role === 'sender' ? c.pay.sender : c.pay.receiver}
          </span>
        </p>
        <p className="text-sm text-ink-2 tabular">{formatPhone(payer.phone)}</p>
        <p className="mt-2 text-sm text-ink-2">
          {payer.role === 'sender' ? c.pay.senderHint : c.pay.receiverHint}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`tel:${payer.phone}`}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent-soft font-semibold text-accent"
          >
            <Phone className="size-4" aria-hidden /> {c.pay.callPayer}
          </a>
          <Button
            variant="ghost"
            icon={<Send className="size-4" aria-hidden />}
            loading={resend.isPending}
            onClick={() => resend.mutate()}
          >
            {c.pay.smsResend}
          </Button>
        </div>
        {job.payerNotifiedAt && <p className="mt-2 text-xs text-success">{c.pay.smsSent}</p>}
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
          <div>
            <p className="text-ink-3">{c.pay.from}</p>
            <p className="font-medium">{job.pickup.contactName}</p>
            <p className="truncate text-ink-3">{job.pickup.address}</p>
          </div>
          <div>
            <p className="text-ink-3">{c.pay.to}</p>
            <p className="font-medium">{job.dropoff.contactName}</p>
            <p className="truncate text-ink-3">{job.dropoff.address}</p>
          </div>
        </div>
      </Panel>

      {/* Payment outcome. */}
      {p ? (
        <Panel className="p-4">
          <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">{c.pay.status}</p>
          <p className={cn('mt-1 flex items-center gap-2 font-semibold', p.status === 'collected' ? 'text-success' : 'text-warning')}>
            <CheckCircle2 className="size-5" aria-hidden />
            {c.pay.statuses[p.status]} · {methodLabel(p.method)}
            {p.reference ? ` · ${p.reference}` : ''}
          </p>
          {p.verification && <p className="mt-1 text-sm text-ink-3">{c.pay.verification[p.verification]}</p>}
          {p.status === 'disputed' && <RecordPayment job={job} compact />}
        </Panel>
      ) : (
        <RecordPayment job={job} />
      )}

      {unreachable}

      {/* Handover and Done. */}
      <Panel className="flex flex-col gap-3 p-4">
        <label className="flex items-center gap-3 text-[15px] font-medium">
          <input
            type="checkbox"
            className="size-5 accent-[var(--c-accent)]"
            checked={handover}
            disabled={!p}
            onChange={(e) => setHandover(e.target.checked)}
          />
          {c.pay.handover}
        </label>
        {!canFinish && <p className="text-sm text-ink-3">{c.pay.doneHint}</p>}
        {finish.error && (
          <Notice tone="danger">
            {finish.error instanceof ApiRequestError ? finish.error.message : String(finish.error)}
          </Notice>
        )}
        <Button size="lg" block disabled={!canFinish} loading={finish.isPending} onClick={() => finish.mutate()} className="h-16 text-lg">
          {c.pay.done}
        </Button>
      </Panel>
    </div>
  );
}

/** Rider records how the payer paid (or that it is disputed). The amount is never sent. */
function RecordPayment({ job, compact = false }: { job: RiderJob; compact?: boolean }) {
  const c = useRiderCopy();
  const qc = useQueryClient();
  const [method, setMethod] = useState<PaymentMethod>(job.farePayment?.method ?? job.preferredPaymentMethod);
  const [reference, setReference] = useState('');
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState('');
  const record = useMutation({
    mutationFn: (outcome: 'collected' | 'disputed') =>
      api(`/rider/jobs/${job.id}/payment`, {
        method: 'POST',
        body: {
          method,
          outcome,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(outcome === 'disputed' ? { note: note.trim() } : {}),
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: riderHomeKey }),
  });
  const fields = record.error instanceof ApiRequestError ? record.error.fields : undefined;
  return (
    <div className={cn('flex flex-col gap-4', !compact && 'rounded-[var(--radius-xl)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]', compact && 'mt-3')}>
      {!compact && <p className="font-semibold">{c.pay.record}</p>}
      <ChoiceGroup
        legend={c.pay.method}
        columns={3}
        value={method}
        onChange={setMethod}
        choices={(['cash', 'telebirr', 'cbe_birr'] as const).map((m) => ({ value: m, label: methodLabel(m) }))}
      />
      {method !== 'cash' && (
        <TextField
          label={c.pay.reference}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          error={fields?.reference}
          maxLength={60}
          autoCapitalize="characters"
          autoComplete="off"
        />
      )}
      {record.error && !fields && <Notice tone="danger">{record.error.message}</Notice>}
      <Button size="lg" block loading={record.isPending && !disputing} onClick={() => record.mutate('collected')}>
        {c.pay.received}
      </Button>
      {method !== 'cash' && !compact && (
        <>
          <button
            type="button"
            className="text-sm font-semibold text-ink-3 underline"
            onClick={() => setDisputing((v) => !v)}
            aria-expanded={disputing}
          >
            {c.pay.cantConfirm}
          </button>
          {disputing && (
            <div className="flex flex-col gap-2">
              <TextField label={c.pay.disputeNote} value={note} onChange={(e) => setNote(e.target.value)} error={fields?.note} maxLength={300} />
              <Button variant="secondary" loading={record.isPending} onClick={() => record.mutate('disputed')}>
                {c.pay.recordDispute}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Full-screen, read-only price for the customer to read off the rider's phone. */
function PriceDisplay({ job, onBack }: { job: RiderJob; onBack: () => void }) {
  const c = useRiderCopy();
  const f = job.finalFare!;
  const p = job.farePayment;
  return (
    <div role="dialog" aria-modal="true" aria-label={c.pay.pleasePay} className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-accent to-[#1e3a8a] px-6 pt-safe pb-safe text-white">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        <p className="text-sm font-semibold tracking-[0.2em] uppercase opacity-80">#{job.code}</p>
        <p className="text-2xl font-bold">{c.pay.pleasePay}</p>
        <p className="text-[clamp(64px,22vw,120px)] leading-none font-extrabold tracking-tight tabular">{f.fare}</p>
        <p className="text-3xl font-bold opacity-90">ETB</p>
        <div className="mt-2 rounded-2xl bg-white/12 px-5 py-3 text-lg font-semibold">
          {job.payerContact.role === 'sender' ? c.pay.sender : c.pay.receiver}
        </div>
        <div className="flex gap-6 text-base opacity-90 tabular">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-4" aria-hidden /> {f.actualDistanceKm.toFixed(1)} km
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-4" aria-hidden /> {minutesLabel(f.actualDurationMin)}
          </span>
        </div>
        <p className="text-lg font-medium">{c.pay.methods}</p>
        <p className="text-base opacity-90">
          {c.pay.status}: {p ? c.pay.statuses[p.status] : c.pay.statuses.none}
        </p>
      </div>
      <Button
        size="lg"
        block
        variant="secondary"
        className="mb-4"
        icon={<ArrowLeft className="size-5" aria-hidden />}
        onClick={onBack}
      >
        {c.pay.back}
      </Button>
    </div>
  );
}
