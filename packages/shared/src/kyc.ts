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
  history: Array<{ action: string; at: string; by: string | null; reason: string | null }>;
}
