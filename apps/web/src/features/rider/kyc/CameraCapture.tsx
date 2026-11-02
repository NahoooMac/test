import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Camera, RefreshCw, X } from 'lucide-react';
import { KYC_MAX_IMAGE_BYTES, type KycDocumentKind } from '@dp/shared';
import { Button, Notice, Spinner, cn } from '../../../ui/index.ts';

type Guide = 'card' | 'plate' | 'face';
export interface CaptureSpec {
  kind: KycDocumentKind;
  guide: Guide;
  facing: 'environment' | 'user';
  /** For face captures: which way to turn the head. */
  pose?: 'front' | 'left' | 'right';
}

export const CAPTURE_SPECS: Record<KycDocumentKind, CaptureSpec> = {
  license: { kind: 'license', guide: 'card', facing: 'environment' },
  plate: { kind: 'plate', guide: 'plate', facing: 'environment' },
  id_front: { kind: 'id_front', guide: 'card', facing: 'environment' },
  id_back: { kind: 'id_back', guide: 'card', facing: 'environment' },
  face_front: { kind: 'face_front', guide: 'face', facing: 'user', pose: 'front' },
  face_left: { kind: 'face_left', guide: 'face', facing: 'user', pose: 'left' },
  face_right: { kind: 'face_right', guide: 'face', facing: 'user', pose: 'right' },
};

const MAX_SIDE = 1600;

/** Encodes the frame as JPEG, lowering quality until it fits the server's size limit. */
function encode(canvas: HTMLCanvasElement): string {
  for (const q of [0.88, 0.78, 0.68, 0.55]) {
    const url = canvas.toDataURL('image/jpeg', q);
    if ((url.length - 23) * 0.75 <= KYC_MAX_IMAGE_BYTES * 0.95) return url;
  }
  return canvas.toDataURL('image/jpeg', 0.45);
}

export type CameraProblem = 'denied' | 'insecure' | 'unavailable';

/**
 * Live camera only: no file picker exists anywhere in this flow, so photos come from the camera at
 * the moment of capture. Shows a guide frame and instructions, then a review step to retake or use.
 */
export function CameraCapture({
  spec,
  onUse,
  onClose,
  busy,
  error,
}: {
  spec: CaptureSpec;
  onUse: (dataUrl: string, capturedAt: string) => void;
  onClose: () => void;
  busy: boolean;
  error: string | null;
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState<{ url: string; at: string } | null>(null);

  // Start the camera for this step; stop it whenever the step changes or the screen closes.
  useEffect(() => {
    if (shot) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setProblem(window.isSecureContext ? 'unavailable' : 'insecure');
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;
    setReady(false);
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: spec.facing },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((tr) => tr.stop());
        stream = s;
        const v = video.current;
        if (!v) return;
        v.srcObject = s;
        void v
          .play()
          .then(() => setReady(true))
          .catch(() => setReady(true));
      })
      .catch((err: DOMException) =>
        setProblem(
          err.name === 'NotAllowedError' || err.name === 'SecurityError' ? 'denied' : 'unavailable',
        ),
      );
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [spec.kind, spec.facing, shot]);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);
    setShot({ url: encode(canvas), at: new Date().toISOString() });
  };

  const mirrored = spec.facing === 'user';

  return (
    <div
      className="fixed inset-0 z-50 mx-auto flex max-w-md flex-col bg-black text-white"
      role="dialog"
    >
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.back')}
          className="flex size-10 items-center justify-center rounded-full bg-white/10"
        >
          <X className="size-5" aria-hidden />
        </button>
        <div className="min-w-0">
          <p className="truncate font-semibold">{t(`kyc.kinds.${spec.kind}.title`)}</p>
          <p className="truncate text-sm text-white/70">{t(`kyc.kinds.${spec.kind}.hint`)}</p>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        {shot ? (
          <img src={shot.url} alt="" className="absolute inset-0 size-full object-contain" />
        ) : (
          <>
            <video
              ref={video}
              playsInline
              muted
              className={cn('absolute inset-0 size-full object-cover', mirrored && '-scale-x-100')}
            />
            {ready && <GuideFrame guide={spec.guide} pose={spec.pose} />}
            {!ready && !problem && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner className="size-7 text-white" />
              </div>
            )}
          </>
        )}
        {problem && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <Notice tone="warning">{t(`kyc.camera.${problem}`)}</Notice>
          </div>
        )}
      </div>

      <footer className="flex flex-col gap-3 px-4 pt-4 pb-safe">
        {error && <Notice tone="danger">{error}</Notice>}
        {shot ? (
          <>
            <p className="text-center text-sm text-white/80">{t('kyc.review')}</p>
            <div className="grid grid-cols-2 gap-3 pb-3">
              <Button
                variant="secondary"
                size="lg"
                onClick={() => setShot(null)}
                disabled={busy}
                icon={<RefreshCw className="size-5" aria-hidden />}
              >
                {t('kyc.retake')}
              </Button>
              <Button size="lg" loading={busy} onClick={() => onUse(shot.url, shot.at)}>
                {t('kyc.usePhoto')}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex justify-center pb-4">
            <button
              type="button"
              onClick={capture}
              disabled={!ready}
              aria-label={t('kyc.capture')}
              className="flex size-18 items-center justify-center rounded-full border-4 border-white bg-white/20 transition-transform active:scale-95 disabled:opacity-40"
            >
              <Camera className="size-7" aria-hidden />
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}

/** Darkens everything outside the target shape and shows the pose instruction for face shots. */
function GuideFrame({ guide, pose }: { guide: Guide; pose?: CaptureSpec['pose'] }) {
  const { t } = useTranslation();
  const shape =
    guide === 'face'
      ? 'aspect-[3/4] w-[62%] rounded-[50%]'
      : guide === 'plate'
        ? 'aspect-[2.2/1] w-[80%] rounded-xl'
        : 'aspect-[1.586/1] w-[86%] rounded-2xl';
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-5">
      <div
        className={cn('border-[3px] border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]', shape)}
      />
      {pose && (
        <p className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-base font-semibold">
          {pose === 'left' && <ArrowLeft className="size-5" aria-hidden />}
          {t(`kyc.pose.${pose}`)}
          {pose === 'right' && <ArrowRight className="size-5" aria-hidden />}
        </p>
      )}
    </div>
  );
}
