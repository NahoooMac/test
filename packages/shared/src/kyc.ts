import { z } from 'zod';
import type { VehicleType } from './enums.ts';

// ── Rider identity verification (KYC) ────────────────────────────────────────
// Live camera captures reviewed by an admin. Capturing a photo proves nothing on its own: an admin
// compares the documents with the face captures and decides. No automated document or liveness
// checks are made.

export const KYC_STATUSES = [
  'not_submitted',
  'pending_review',
  'approved',
  'rejected',
  'resubmission_required',
] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const KYC_DOCUMENT_KINDS = [
  'license',
  'plate',
  'id_front',
  'id_back',
  'face_front',
  'face_left',
  'face_right',
] as const;
export type KycDocumentKind = (typeof KYC_DOCUMENT_KINDS)[number];

/** Riders can (re)capture only while their application is open for changes. */
export const KYC_EDITABLE: readonly KycStatus[] = [
  'not_submitted',
  'rejected',
  'resubmission_required',
];

/** Bicycles have no licence or plate; motorcycles and scooters need both. */
export function kycRequiredKinds(vehicle: VehicleType): KycDocumentKind[] {
  const motor: KycDocumentKind[] = vehicle === 'bicycle' ? [] : ['license', 'plate'];
  return [...motor, 'id_front', 'id_back', 'face_front', 'face_left', 'face_right'];
}

/** Largest accepted capture, after the app's own resizing (JPEG, ≤1600 px). */
export const KYC_MAX_IMAGE_BYTES = 900 * 1024;

export const kycUploadSchema = z.object({
  /** Base64 JPEG (a `data:image/jpeg;base64,` prefix is allowed). */
  image: z
    .string()
    .min(100)
    .max(Math.ceil((KYC_MAX_IMAGE_BYTES * 4) / 3) + 64),
  /** When the camera took it, per the device (informational for reviewers). */
  capturedAt: z.string().datetime().optional(),
});

export interface KycCapture {
  kind: KycDocumentKind;
  capturedAt: string | null;
  uploadedAt: string;
}

export interface RiderKyc {
  status: KycStatus;
  /** Admin's message when rejected or asking for retakes. */
  reason: string | null;
  /** Captures the admin asked to redo. */
  retake: KycDocumentKind[];
  required: KycDocumentKind[];
  captured: KycCapture[];
  submittedAt: string | null;
  reviewedAt: string | null;
  /** Whether the current face frames come from a passed liveness session. */
  livenessPassed: boolean;
}

export const adminKycDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'resubmit']),
    reason: z.string().trim().max(300).optional(),
    retake: z.array(z.enum(KYC_DOCUMENT_KINDS)).max(KYC_DOCUMENT_KINDS.length).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision !== 'approve' && !v.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Tell the rider what to fix.' });
    }
    if (v.decision === 'resubmit' && !v.retake?.length) {
      ctx.addIssue({ code: 'custom', path: ['retake'], message: 'Pick the photos to retake.' });
    }
  });

export interface AdminKycRow {
  userId: string;
  fullName: string | null;
  phone: string;
  vehicleType: VehicleType;
  plateNumber: string | null;
  kycStatus: KycStatus;
  approvalStatus: string;
  submittedAt: string | null;
  reviewedAt: string | null;
}

export interface AdminKycDetail extends AdminKycRow {
  reason: string | null;
  retake: KycDocumentKind[];
  required: KycDocumentKind[];
  captured: KycCapture[];
  accountCreatedAt: string;
  /** Latest liveness session (null for applications made before liveness existed). */
  liveness: AdminLivenessSummary | null;
  history: Array<{ action: string; at: string; by: string | null; reason: string | null }>;
}

// ── Face liveness (guided head movements) ────────────────────────────────────
// The rider follows a randomized sequence of head movements in front of the live camera. The app
// measures head pose from face landmarks (MediaPipe) and captures a frame for each face kind. This
// raises the bar against photos and casual replays, but it is NOT biometric liveness assurance:
// an admin still reviews every application, and a pass never approves a rider by itself.

export const LIVENESS_ACTIONS = ['straight', 'right', 'left', 'center'] as const;
export type LivenessAction = (typeof LIVENESS_ACTIONS)[number];

/** The face frame each action produces ('center' only proves the return, no frame is kept). */
export const LIVENESS_FRAME: Partial<Record<LivenessAction, 'face_front' | 'face_right' | 'face_left'>> = {
  straight: 'face_front',
  right: 'face_right',
  left: 'face_left',
};

/** Face kinds that can only come from a live liveness session (never a plain upload). */
export const LIVENESS_KINDS: readonly KycDocumentKind[] = ['face_front', 'face_left', 'face_right'];

/** Configurable acceptance thresholds (admin settings); calibrate on real phones. */
export interface LivenessThresholds {
  /** Head yaw needed for "turn right/left", degrees. */
  turnYawDeg: number;
  /** Max |yaw| for "look straight"/"back to centre", degrees. */
  centerYawDeg: number;
  /** Max |pitch| (nodding) while any action is held, degrees. */
  maxPitchDeg: number;
  /** How long the pose must be held, continuously, ms. */
  holdMs: number;
  /** Min face size as a share of the frame area (too far away = too small to review). */
  minFaceArea: number;
  /**
   * Max movement of the face centre (share of frame width) between "straight" and a turn: a head
   * turns in place, while moving the phone around a still face slides it across the frame.
   */
  maxFaceShift: number;
  /** Session lifetime, seconds (a challenge can't be answered later or replayed). */
  sessionSeconds: number;
}

export const DEFAULT_LIVENESS: LivenessThresholds = {
  turnYawDeg: 22,
  centerYawDeg: 10,
  maxPitchDeg: 25,
  holdMs: 700,
  minFaceArea: 0.05,
  maxFaceShift: 0.22,
  sessionSeconds: 180,
};

export interface LivenessSession {
  id: string;
  sequence: LivenessAction[];
  expiresAt: string;
  thresholds: LivenessThresholds;
  completed: number;
}

/** What the app measured while the action was held (server re-checks against the thresholds). */
export const livenessMetricsSchema = z.object({
  yawDeg: z.number().min(-90).max(90),
  pitchDeg: z.number().min(-90).max(90),
  holdMs: z.number().int().min(0).max(60_000),
  faceCount: z.number().int().min(0).max(10),
  faceArea: z.number().min(0).max(1),
  /** Face-centre movement from the "straight" pose, share of frame width. */
  faceShift: z.number().min(0).max(2),
  /** Std-dev of yaw over the hold window (degrees): ~0 for a printed/static image held still. */
  jitterDeg: z.number().min(0).max(90),
  /** Largest yaw change between consecutive frames during the action (spliced video = jumps). */
  maxStepDeg: z.number().min(0).max(180),
  blinks: z.number().int().min(0).max(100),
});
export type LivenessMetrics = z.infer<typeof livenessMetricsSchema>;

export const livenessStepSchema = z.object({
  index: z.number().int().min(0).max(10),
  action: z.enum(LIVENESS_ACTIONS),
  /** Base64 JPEG frame, required for straight / right / left. */
  image: z.string().max(Math.ceil((KYC_MAX_IMAGE_BYTES * 4) / 3) + 64).optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  metrics: livenessMetricsSchema,
  /** Browser + model info, for reviewers (no biometric data). */
  client: z
    .object({ userAgent: z.string().max(300), model: z.string().max(80), camera: z.string().max(120).optional() })
    .optional(),
});

export interface LivenessStepRecord {
  index: number;
  action: LivenessAction;
  startedAt: string;
  completedAt: string;
  receivedAt: string;
  metrics: LivenessMetrics;
}

/** The liveness evidence an admin sees next to the face frames. */
export interface AdminLivenessSummary {
  id: string;
  status: 'active' | 'passed' | 'failed' | 'expired' | 'superseded';
  sequence: LivenessAction[];
  steps: LivenessStepRecord[];
  createdAt: string;
  completedAt: string | null;
  failedAttempts: number;
  client: { userAgent: string; model: string; camera?: string | undefined } | null;
  /** Signals worth a closer look (not automatic decisions). */
  flags: string[];
}
