import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Camera,
  Check,
  CircleAlert,
  Clock,
  IdCard,
  Lock,
  RectangleHorizontal,
  ScanFace,
  ShieldCheck,
} from 'lucide-react';
import { KYC_EDITABLE, LIVENESS_KINDS, type KycDocumentKind, type RiderKyc } from '@dp/shared';
import { api, ApiRequestError } from '../../../lib/api.ts';
import { Button, EmptyState, Notice, Panel, Skeleton, cn } from '../../../ui/index.ts';
import { riderHomeKey } from '../hooks.ts';
import { CAPTURE_SPECS, CameraCapture } from './CameraCapture.tsx';
import { LivenessCheck } from './LivenessCheck.tsx';

const isFace = (k: KycDocumentKind) => LIVENESS_KINDS.includes(k);

const kycKey = ['rider', 'kyc'] as const;

const ICON: Record<KycDocumentKind, typeof IdCard> = {
  license: IdCard,
  plate: RectangleHorizontal,
  id_front: IdCard,
  id_back: IdCard,
  face_front: ScanFace,
  face_left: ScanFace,
  face_right: ScanFace,
};

/**
 * Identity verification before a rider can take jobs: live camera photos of the licence, plate,
 * national ID (both sides) and face (front, left, right), then an admin reviews them.
 */
export function KycFlow() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const kyc = useQuery({ queryKey: kycKey, queryFn: () => api<RiderKyc>('/rider/kyc') });
  const [started, setStarted] = useState(false);
  const [active, setActive] = useState<KycDocumentKind | null>(null);

  const upload = useMutation({
    mutationFn: (v: { kind: KycDocumentKind; image: string; capturedAt: string }) =>
      api<RiderKyc>(`/rider/kyc/documents/${v.kind}`, {
        method: 'PUT',
        body: { image: v.image, capturedAt: v.capturedAt },
      }),
    onSuccess: (data, v) => {
      queryClient.setQueryData(kycKey, data);
      // Move on to the next photo still needed, or back to the checklist.
      const next = data.required.find((k) => k !== v.kind && needs(data, k));
      setActive(next ?? null);
    },
  });
  const submit = useMutation({
    mutationFn: () => api<RiderKyc>('/rider/kyc/submit', { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.setQueryData(kycKey, data);
      void queryClient.invalidateQueries({ queryKey: riderHomeKey });
    },
  });

  if (kyc.isPending) return <Skeleton className="m-4 h-64" />;
  if (kyc.isError)
    return (
      <Notice tone="danger" className="m-4">
        {kyc.error.message}
      </Notice>
    );
  const k = kyc.data;

  if (k.status === 'pending_review') {
    return (
      <EmptyState
        className="pt-20"
        icon={<Clock className="size-6" aria-hidden />}
        title={t('kyc.pending.title')}
        body={t('kyc.pending.body')}
      />
    );
  }
  if (!KYC_EDITABLE.includes(k.status)) return null;

  if (active && isFace(active)) {
    // Face photos only come from the live face check (one session captures all three).
    return (
      <LivenessCheck
        onClose={() => setActive(null)}
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: kycKey });
          setActive(null);
        }}
      />
    );
  }

  if (active) {
    return (
      <CameraCapture
        key={active}
        spec={CAPTURE_SPECS[active]}
        busy={upload.isPending}
        error={upload.error ? errorText(upload.error) : null}
        onClose={() => {
          upload.reset();
          setActive(null);
        }}
        onUse={(image, capturedAt) => upload.mutate({ kind: active, image, capturedAt })}
      />
    );
  }

  const fresh = k.status === 'not_submitted' && k.captured.length === 0;
  if (fresh && !started) {
    return (
      <Intro
        onStart={() => {
          setStarted(true);
          setActive(k.required[0] ?? null); // the browser asks for camera access here
        }}
      />
    );
  }

  const missing = k.required.filter((kind) => needs(k, kind));
  // The three face kinds are one checklist row: the live face check.
  const rows = k.required.filter((kind) => !isFace(kind) || kind === 'face_front');
  const first = missing[0];

  return (
    <div className="flex flex-col gap-4 px-4 pt-6 pb-6">
      <div>
        <h1 className="text-[24px] font-bold tracking-tight">{t('kyc.title')}</h1>
        <p className="mt-1 text-sm text-ink-3">{t('kyc.subtitle')}</p>
      </div>

      {k.status !== 'not_submitted' && k.reason && (
        <Notice tone="warning">
          <span className="block font-semibold">
            {t(k.status === 'rejected' ? 'kyc.rejected' : 'kyc.resubmit')}
          </span>
          {k.reason}
        </Notice>
      )}

      <Panel className="divide-y divide-line">
        {rows.map((kind) => {
          const Icon = ICON[kind];
          const face = isFace(kind);
          const done = face ? !LIVENESS_KINDS.some((f) => needs(k, f)) : !needs(k, kind);
          const redo = (face ? LIVENESS_KINDS.some((f) => k.retake.includes(f)) : k.retake.includes(kind)) && !done;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => setActive(kind)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
            >
              <span
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-full',
                  done
                    ? 'bg-success-soft text-success'
                    : redo
                      ? 'bg-warning-soft text-warning'
                      : 'bg-surface-2 text-ink-3',
                )}
              >
                {done ? (
                  <Check className="size-5" aria-hidden />
                ) : (
                  <Icon className="size-5" aria-hidden />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {face ? 'Live face check' : t(`kyc.kinds.${kind}.title`)}
                </span>
                <span className={cn('block text-sm', redo ? 'text-warning' : 'text-ink-3')}>
                  {done ? t('kyc.captured') : redo ? t('kyc.needsRetake') : t('kyc.notYet')}
                </span>
              </span>
              <span className="text-sm font-semibold text-accent">
                {done ? t('kyc.retake') : t('kyc.capture')}
              </span>
            </button>
          );
        })}
      </Panel>

      {submit.isError && <Notice tone="danger">{errorText(submit.error)}</Notice>}

      {first ? (
        <Button
          size="lg"
          block
          icon={<Camera className="size-5" aria-hidden />}
          onClick={() => setActive(first)}
        >
          {t('kyc.continue', { count: missing.length })}
        </Button>
      ) : (
        <Button size="lg" block loading={submit.isPending} onClick={() => submit.mutate()}>
          {t('kyc.submit')}
        </Button>
      )}
      <p className="flex items-start gap-2 text-xs text-ink-3">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t('kyc.privacy')}
      </p>
    </div>
  );
}

/**
 * A photo still needed: not captured, captured before the admin asked for a retake, or (faces) not
 * from a passed live face check.
 */
function needs(k: RiderKyc, kind: KycDocumentKind): boolean {
  const cap = k.captured.find((c) => c.kind === kind);
  if (!cap) return true;
  if (isFace(kind) && !k.livenessPassed) return true;
  return (
    k.status === 'resubmission_required' &&
    k.retake.includes(kind) &&
    !!k.reviewedAt &&
    cap.uploadedAt <= k.reviewedAt
  );
}

function errorText(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const field = err.fields && Object.values(err.fields)[0];
    return field ?? err.message;
  }
  return String(err);
}

/** Explains what will be captured and why the camera is needed, before asking for permission. */
function Intro({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-5 px-4 pt-8 pb-6">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <ShieldCheck className="size-7" aria-hidden />
      </span>
      <div>
        <h1 className="text-[26px] leading-tight font-bold tracking-tight">
          {t('kyc.intro.title')}
        </h1>
        <p className="mt-2 text-[15px] text-ink-2">{t('kyc.intro.body')}</p>
      </div>
      <Panel className="flex flex-col gap-3 p-4 text-sm">
        {(['documents', 'face', 'review'] as const).map((s) => (
          <p key={s} className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            {t(`kyc.intro.${s}`)}
          </p>
        ))}
      </Panel>
      <Notice tone="info">{t('kyc.intro.camera')}</Notice>
      <Button size="lg" block icon={<Camera className="size-5" aria-hidden />} onClick={onStart}>
        {t('kyc.intro.start')}
      </Button>
      <p className="flex items-start gap-2 text-xs text-ink-3">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t('kyc.privacy')}
      </p>
    </div>
  );
}
