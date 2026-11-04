// Live face check for rider KYC: guided head movements measured on-device with MediaPipe Face
// Landmarker. The server issues the action sequence and time limit, re-checks every measurement,
// and keeps one frame per face action for the admin. Nothing here approves a rider.
//
// Head pose: yaw/pitch come from the facial transformation matrix; the turn direction is
// cross-checked with where the nose sits between the cheeks. A head turning stays in place in the
// frame, while moving the phone around a still face slides it across: that shift is measured too.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CameraOff, Check, RotateCcw, ScanFace, X } from 'lucide-react';
import type { LivenessAction, LivenessSession } from '@dp/shared';
import { api, ApiRequestError } from '../../../lib/api.ts';
import { Button, cn, Notice, Spinner } from '../../../ui/index.ts';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const MODEL_NAME = 'face_landmarker float16/1 · tasks-vision 1.1.1';
/** ~15 detections per second: smooth enough, and light on low-end Android phones. */
const DETECT_EVERY_MS = 66;

const INSTRUCTION: Record<LivenessAction, string> = {
  straight: 'Look straight at the camera',
  right: 'Slowly turn your head to the right',
  left: 'Slowly turn your head to the left',
  center: 'Turn back to the centre',
};

type Phase =
  | { kind: 'loading'; text: string }
  | { kind: 'error'; text: string; retry: boolean }
  | { kind: 'running' }
  | { kind: 'sending' }
  | { kind: 'done' };

interface Pose {
  faces: number;
  yawDeg: number;
  pitchDeg: number;
  area: number;
  cx: number;
  cy: number;
  blink: boolean;
}

/** Head pose from one MediaPipe result (positive yaw = the rider's right). */
function readPose(result: {
  faceLandmarks: Array<Array<{ x: number; y: number }>>;
  facialTransformationMatrixes?: Array<{ data: number[] | Float32Array }>;
  faceBlendshapes?: Array<{ categories: Array<{ categoryName: string; score: number }> }>;
}): Pose {
  const faces = result.faceLandmarks.length;
  if (faces !== 1) return { faces, yawDeg: 0, pitchDeg: 0, area: 0, cx: 0, cy: 0, blink: false };
  const lm = result.faceLandmarks[0]!;
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // Nose tip (1) between the cheek edges (234, 454), in the unmirrored camera image: turning to
  // the rider's right moves the nose towards the image's left edge.
  const nose = lm[1]!, a = lm[234]!, b = lm[454]!;
  const ratio = (nose.x - Math.min(a.x, b.x)) / Math.max(1e-6, Math.abs(b.x - a.x));
  const geoYaw = (Math.asin(Math.max(-1, Math.min(1, (0.5 - ratio) * 2))) * 180) / Math.PI;
  let yawDeg = geoYaw;
  let pitchDeg = 0;
  const m = result.facialTransformationMatrixes?.[0]?.data;
  if (m && m.length >= 16) {
    // Column-major 4×4: R[r][c] = m[c * 4 + r].
    const r20 = m[2]!, r21 = m[6]!, r22 = m[10]!;
    const matYaw = (Math.asin(Math.max(-1, Math.min(1, -r20))) * 180) / Math.PI;
    pitchDeg = (Math.atan2(r21, r22) * 180) / Math.PI;
    // Magnitude from the 3D model, direction from the landmarks (independent of mirroring).
    yawDeg = Math.abs(geoYaw) < 3 ? matYaw * Math.sign(geoYaw || matYaw) : Math.abs(matYaw) * Math.sign(geoYaw);
  }
  const shapes = result.faceBlendshapes?.[0]?.categories ?? [];
  const score = (n: string) => shapes.find((c) => c.categoryName === n)?.score ?? 0;
  return {
    faces,
    yawDeg,
    pitchDeg,
    area: (maxX - minX) * (maxY - minY),
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    blink: score('eyeBlinkLeft') > 0.5 && score('eyeBlinkRight') > 0.5,
  };
}

const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
};

export function LivenessCheck({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading', text: 'Starting the camera…' });
  const [session, setSession] = useState<LivenessSession | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const [holdPct, setHoldPct] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Mutable tracking state (per animation frame; not React state).
  const track = useRef({
    stepStartedAt: 0,
    holdSince: 0,
    yaws: [] as number[],
    maxStepDeg: 0,
    lastYaw: null as number | null,
    blinks: 0,
    blinking: false,
    straightCenter: null as { x: number; y: number } | null,
    lastPose: null as Pose | null,
    busy: false,
  });

  const resetStep = useCallback(() => {
    const t = track.current;
    t.stepStartedAt = Date.now();
    t.holdSince = 0;
    t.yaws = [];
    t.maxStepDeg = 0;
    t.lastYaw = null;
    t.blinks = 0;
    t.busy = false;
    setHoldPct(0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;
    let landmarker: { detectForVideo: (v: HTMLVideoElement, t: number) => unknown; close: () => void } | null = null;
    let lastDetect = 0;
    let localSession: LivenessSession | null = null;
    let index = 0;

    const fail = (text: string, retry = true) => !cancelled && setPhase({ kind: 'error', text, retry });

    async function send(action: LivenessAction, pose: Pose) {
      const t = track.current;
      t.busy = true;
      const v = video.current!;
      let image: string | undefined;
      if (action !== 'center') {
        const canvas = document.createElement('canvas');
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        canvas.getContext('2d')!.drawImage(v, 0, 0); // unmirrored, as the camera saw it
        image = canvas.toDataURL('image/jpeg', 0.88).replace(/^data:image\/jpeg;base64,/, '');
      }
      const shift = t.straightCenter ? Math.hypot(pose.cx - t.straightCenter.x, pose.cy - t.straightCenter.y) : 0;
      setPhase({ kind: 'sending' });
      try {
        const res = await api<LivenessSession & { status: string }>(
          `/rider/kyc/liveness/${localSession!.id}/steps`,
          {
            method: 'POST',
            body: {
              index,
              action,
              image,
              startedAt: new Date(t.stepStartedAt).toISOString(),
              completedAt: new Date().toISOString(),
              metrics: {
                yawDeg: Math.round(pose.yawDeg * 10) / 10,
                pitchDeg: Math.round(pose.pitchDeg * 10) / 10,
                holdMs: Date.now() - t.holdSince,
                faceCount: pose.faces,
                faceArea: Math.round(pose.area * 1000) / 1000,
                faceShift: Math.round(shift * 1000) / 1000,
                jitterDeg: Math.round(std(t.yaws.slice(-20)) * 100) / 100,
                maxStepDeg: Math.round(t.maxStepDeg * 10) / 10,
                blinks: t.blinks,
              },
              client: { userAgent: navigator.userAgent.slice(0, 300), model: MODEL_NAME },
            },
          },
        );
        if (cancelled) return;
        if (action === 'straight') t.straightCenter = { x: pose.cx, y: pose.cy };
        if (res.status === 'passed') {
          setPhase({ kind: 'done' });
          return;
        }
        index += 1;
        setStepIndex(index);
        setHint(null);
        resetStep();
        setPhase({ kind: 'running' });
      } catch (err) {
        if (cancelled) return;
        const code = err instanceof ApiRequestError ? err.code : '';
        if (code === 'LIVENESS_EXPIRED' || code === 'LIVENESS_CLOSED' || code === 'NOT_FOUND') {
          fail(err instanceof Error ? err.message : 'Start again.');
          return;
        }
        setHint(err instanceof Error ? err.message : 'Try again.');
        resetStep();
        setPhase({ kind: 'running' });
      }
    }

    function loop() {
      raf = requestAnimationFrame(loop);
      const v = video.current;
      const now = performance.now();
      if (!v || !landmarker || !localSession || v.readyState < 2 || now - lastDetect < DETECT_EVERY_MS) return;
      lastDetect = now;
      const t = track.current;
      if (t.busy) return;
      const pose = readPose(landmarker.detectForVideo(v, now) as Parameters<typeof readPose>[0]);
      t.lastPose = pose;
      const th = localSession.thresholds;
      const action = localSession.sequence[index]!;
      if (pose.faces === 0) return setHint('Place your face inside the oval'), resetHold();
      if (pose.faces > 1) return setHint('Only you should be in the picture'), resetHold();
      if (pose.area < th.minFaceArea) return setHint('Move closer to the camera'), resetHold();
      if (t.lastYaw !== null) t.maxStepDeg = Math.max(t.maxStepDeg, Math.abs(pose.yawDeg - t.lastYaw));
      t.lastYaw = pose.yawDeg;
      t.yaws.push(pose.yawDeg);
      if (t.yaws.length > 60) t.yaws.shift();
      if (pose.blink && !t.blinking) t.blinks += 1;
      t.blinking = pose.blink;

      const turned =
        action === 'right'
          ? pose.yawDeg >= th.turnYawDeg
          : action === 'left'
            ? pose.yawDeg <= -th.turnYawDeg
            : Math.abs(pose.yawDeg) <= th.centerYawDeg;
      const level = Math.abs(pose.pitchDeg) <= th.maxPitchDeg;
      const shift = t.straightCenter ? Math.hypot(pose.cx - t.straightCenter.x, pose.cy - t.straightCenter.y) : 0;
      const still = action === 'straight' || action === 'center' || shift <= th.maxFaceShift;
      if (!level) return setHint('Keep your head level'), resetHold();
      if (!still) return setHint('Keep the phone still and turn only your head'), resetHold();
      if (!turned) {
        setHint(null);
        return resetHold();
      }
      if (!t.holdSince) t.holdSince = Date.now();
      const held = Date.now() - t.holdSince;
      setHoldPct(Math.min(100, Math.round((held / (th.holdMs + 150)) * 100)));
      setHint('Hold still…');
      if (held >= th.holdMs + 150) void send(action, pose);
    }
    function resetHold() {
      track.current.holdSince = 0;
      setHoldPct(0);
    }

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        return fail('This browser cannot use the camera. Open the app in Chrome on your phone.', false);
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch (err) {
        const name = (err as DOMException)?.name;
        return fail(
          name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.'
            : name === 'NotFoundError'
              ? 'No front camera was found on this device.'
              : 'The camera could not start. Close other apps using it and try again.',
        );
      }
      if (cancelled) return stream.getTracks().forEach((tr) => tr.stop());
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);

      setPhase({ kind: 'loading', text: 'Loading face detection…' });
      try {
        const vision = await import('@mediapipe/tasks-vision');
        const files = await vision.FilesetResolver.forVisionTasks('/mediapipe');
        const options = (delegate: 'GPU' | 'CPU') => ({
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'VIDEO' as const,
          numFaces: 2,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
        try {
          landmarker = await vision.FaceLandmarker.createFromOptions(files, options('GPU'));
        } catch {
          landmarker = await vision.FaceLandmarker.createFromOptions(files, options('CPU'));
        }
      } catch {
        return fail('Face detection could not load. Check your internet connection and try again.');
      }
      if (cancelled) return;

      try {
        localSession = await api<LivenessSession>('/rider/kyc/liveness', { method: 'POST' });
      } catch (err) {
        return fail(err instanceof Error ? err.message : 'Could not start the face check.');
      }
      if (cancelled) return;
      setSession(localSession);
      setStepIndex(0);
      track.current.straightCenter = null;
      resetStep();
      setPhase({ kind: 'running' });
      raf = requestAnimationFrame(loop);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
      landmarker?.close();
    };
  }, [attempt, resetStep]);

  // Session countdown.
  useEffect(() => {
    if (!session) return;
    const tick = () => {
      const s = Math.max(0, Math.round((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(s);
      if (s === 0) setPhase((p) => (p.kind === 'done' ? p : { kind: 'error', text: 'Time ran out. Start again.', retry: true }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session]);

  const action = session?.sequence[stepIndex];
  const total = session?.sequence.length ?? 4;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0b1220] text-white">
      <div className="flex items-center justify-between px-4 pt-safe pb-2">
        <button type="button" aria-label="Close" onClick={onClose} className="flex size-11 items-center justify-center">
          <X className="size-6" aria-hidden />
        </button>
        <p className="font-semibold">Live face check</p>
        <span className="w-11 text-right text-sm tabular opacity-80">{secondsLeft != null ? `${secondsLeft}s` : ''}</span>
      </div>

      {/* Progress */}
      <ol className="flex justify-center gap-2 px-4 pb-3" aria-label="Progress">
        {Array.from({ length: total }, (_, i) => (
          <li
            key={i}
            className={cn(
              'h-1.5 w-12 rounded-full',
              phase.kind === 'done' || i < stepIndex ? 'bg-accent-2' : i === stepIndex ? 'bg-white' : 'bg-white/25',
            )}
          />
        ))}
      </ol>

      <div className="relative mx-4 flex-1 overflow-hidden rounded-3xl bg-black">
        {/* Mirrored preview feels natural; captured frames are not mirrored. */}
        <video ref={video} playsInline muted className="absolute inset-0 size-full -scale-x-100 object-cover" />
        <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <mask id="oval">
              <rect width="100" height="100" fill="white" />
              <ellipse cx="50" cy="46" rx="30" ry="34" fill="black" />
            </mask>
          </defs>
          <rect width="100" height="100" fill="rgba(11,18,32,0.55)" mask="url(#oval)" />
          <ellipse cx="50" cy="46" rx="30" ry="34" fill="none" stroke={holdPct > 0 ? '#60a5fa' : 'white'} strokeWidth="0.8" strokeDasharray={holdPct > 0 ? `${holdPct * 2.03} 400` : '2 1.5'} />
        </svg>
        {phase.kind === 'running' && action && (action === 'right' || action === 'left') && (
          <div className={cn('absolute top-1/2 -translate-y-1/2 animate-pulse', action === 'right' ? 'right-3' : 'left-3')}>
            {action === 'right' ? <ArrowRight className="size-12 text-accent-2" aria-hidden /> : <ArrowLeft className="size-12 text-accent-2" aria-hidden />}
          </div>
        )}
        {(phase.kind === 'loading' || phase.kind === 'sending') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40">
            <Spinner className="size-8" />
            {phase.kind === 'loading' && <p className="text-sm">{phase.text}</p>}
          </div>
        )}
        {phase.kind === 'done' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60">
            <span className="flex size-16 items-center justify-center rounded-full bg-success">
              <Check className="size-9" aria-hidden />
            </span>
            <p className="text-lg font-semibold">Face check complete</p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 px-4 pt-4 pb-safe">
        {phase.kind === 'error' ? (
          <>
            <Notice tone="danger" className="flex items-start gap-2">
              <CameraOff className="mt-0.5 size-4 shrink-0" aria-hidden /> {phase.text}
            </Notice>
            {phase.retry && (
              <Button size="lg" block icon={<RotateCcw className="size-5" aria-hidden />} onClick={() => setAttempt((n) => n + 1)}>
                Start again
              </Button>
            )}
          </>
        ) : phase.kind === 'done' ? (
          <Button size="lg" block onClick={onDone}>
            Continue
          </Button>
        ) : (
          <>
            <p className="flex min-h-14 items-center justify-center gap-2 text-center text-xl font-bold" aria-live="polite">
              <ScanFace className="size-6 shrink-0 text-accent-2" aria-hidden />
              {action ? INSTRUCTION[action] : 'Get ready…'}
            </p>
            <p className="min-h-5 text-center text-sm text-white/75" aria-live="polite">
              {hint ?? 'Good light, face inside the oval, phone held still.'}
            </p>
          </>
        )}
        <p className="pb-3 text-center text-xs text-white/50">
          Kept for the review: 3 encrypted frames and the head angles of each step. No face template is stored.
        </p>
      </div>
    </div>
  );
}
