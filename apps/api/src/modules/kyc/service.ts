// Rider identity verification (KYC): live camera captures, encrypted at rest, reviewed by an admin.
//
// What this does and does not prove: the app only lets riders use the live camera (no gallery
// upload), and the server checks each file is a real, reasonably sized JPEG. It does NOT check that
// a document is genuine or that the face matches the ID — an admin compares them and decides.
//
// Storage: AES-256-GCM per photo, key from config (never in the database), with rider + kind as
// associated data so a ciphertext can't be swapped onto another rider. Photos are only readable
// through admin endpoints, are deleted on rejection / retake, and after KYC_RETENTION_DAYS.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import {
  KYC_EDITABLE,
  KYC_MAX_IMAGE_BYTES,
  kycRequiredKinds,
  type AdminKycDetail,
  type AdminKycRow,
  type KycDocumentKind,
  type KycStatus,
  type RiderKyc,
} from '@dp/shared';
import type { z } from 'zod';
import type { adminKycDecisionSchema } from '@dp/shared';
import type { Config } from '../../config/env.ts';
import type { Db } from '../../db/client.ts';
import { adminAuditLog, kycDocuments, riders, users } from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError } from '../../shared/errors.ts';
import { audit } from '../admin/audit.ts';
import { noopRealtime, type Realtime } from '../realtime/hub.ts';

const MIN_IMAGE_BYTES = 8 * 1024;
const MIN_SIDE_PX = 360;
const DAY_MS = 86_400_000;

const notFound = () => new AppError(404, 'NOT_FOUND', 'Apply to ride first.');
const locked = () =>
  new AppError(409, 'KYC_LOCKED', 'Your verification is being reviewed or already approved.');
const badImage = (msg: string) =>
  new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid.', { fields: { image: msg } });

/** Width × height from a JPEG's frame header, or null if it isn't a well-formed JPEG. */
export function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC), carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

export class KycService {
  private readonly key: Buffer;
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly realtime: Realtime;
  private readonly retentionDays: number;

  constructor(db: Db, config: Config, clock: Clock, realtime: Realtime = noopRealtime) {
    this.db = db;
    this.clock = clock;
    this.realtime = realtime;
    this.retentionDays = config.KYC_RETENTION_DAYS;
    this.key = config.KYC_ENCRYPTION_KEY
      ? Buffer.from(config.KYC_ENCRYPTION_KEY, 'base64')
      : createHash('sha256').update(`kyc-dev-key:${config.OTP_HMAC_SECRET}`).digest();
  }

  // ── crypto ───────────────────────────────────────────────────────────────────

  private encrypt(plain: Buffer, aad: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  private decrypt(row: { ciphertext: string; iv: string; authTag: string }, aad: string): Buffer {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(row.iv, 'base64'));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(row.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(row.ciphertext, 'base64')),
      decipher.final(),
    ]);
  }

  // ── rider ────────────────────────────────────────────────────────────────────

  private async rider(userId: string) {
    const [r] = await this.db.select().from(riders).where(eq(riders.userId, userId));
    if (!r) throw notFound();
    return r;
  }

  private async captures(riderId: string) {
    return this.db
      .select({
        kind: kycDocuments.kind,
        capturedAt: kycDocuments.capturedAt,
        createdAt: kycDocuments.createdAt,
      })
      .from(kycDocuments)
      .where(eq(kycDocuments.riderId, riderId));
  }

  async view(userId: string): Promise<RiderKyc> {
    const r = await this.rider(userId);
    const caps = await this.captures(userId);
    return {
      status: r.kycStatus,
      reason: r.kycReason,
      retake: r.kycRetake,
      required: kycRequiredKinds(r.vehicleType),
      captured: caps.map((c) => ({
        kind: c.kind,
        capturedAt: c.capturedAt?.toISOString() ?? null,
        uploadedAt: c.createdAt.toISOString(),
      })),
      submittedAt: r.kycSubmittedAt?.toISOString() ?? null,
      reviewedAt: r.kycReviewedAt?.toISOString() ?? null,
    };
  }

  /** Stores (or replaces) one capture. Only while the application is open for changes. */
  async upload(
    userId: string,
    kind: KycDocumentKind,
    imageBase64: string,
    capturedAt: string | undefined,
  ): Promise<RiderKyc> {
    const r = await this.rider(userId);
    if (!KYC_EDITABLE.includes(r.kycStatus)) throw locked();
    if (!kycRequiredKinds(r.vehicleType).includes(kind)) {
      throw new AppError(400, 'VALIDATION_FAILED', 'This photo is not needed for your vehicle.');
    }
    const data = Buffer.from(imageBase64.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
    if (data.length > KYC_MAX_IMAGE_BYTES) badImageThrow('The photo is too large.');
    if (data.length < MIN_IMAGE_BYTES) badImageThrow('The photo is too small or blank. Retake it.');
    const size = jpegSize(data);
    if (!size) badImageThrow('Only photos from the camera (JPEG) are accepted.');
    if (Math.min(size!.width, size!.height) < MIN_SIDE_PX) {
      badImageThrow('The photo is too low-resolution. Retake it closer, in good light.');
    }
    const now = this.clock.now();
    const enc = this.encrypt(data, `${userId}:${kind}`);
    const row = {
      ...enc,
      mime: 'image/jpeg',
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      capturedAt: capturedAt ? new Date(capturedAt) : null,
      createdAt: now,
    };
    await this.db
      .insert(kycDocuments)
      .values({ riderId: userId, kind, ...row })
      .onConflictDoUpdate({ target: [kycDocuments.riderId, kycDocuments.kind], set: row });
    return this.view(userId);
  }

  /** Sends the application for review once every required photo (and every retake) is in. */
  async submit(userId: string): Promise<RiderKyc> {
    const r = await this.rider(userId);
    if (!KYC_EDITABLE.includes(r.kycStatus)) throw locked();
    const caps = await this.captures(userId);
    const have = new Map(caps.map((c) => [c.kind, c.createdAt]));
    const missing = kycRequiredKinds(r.vehicleType).filter((k) => !have.has(k));
    // A retake only counts if it was captured after the admin asked for it.
    const stale =
      r.kycStatus === 'resubmission_required' && r.kycReviewedAt
        ? r.kycRetake.filter((k) => !have.has(k) || have.get(k)! <= r.kycReviewedAt!)
        : [];
    if (missing.length || stale.length) {
      throw new AppError(409, 'KYC_INCOMPLETE', 'Some photos are still missing.', {
        details: { missing: [...new Set([...missing, ...stale])] },
      });
    }
    const now = this.clock.now();
    await this.db
      .update(riders)
      .set({ kycStatus: 'pending_review', kycSubmittedAt: now, updatedAt: now })
      .where(and(eq(riders.userId, userId), eq(riders.kycStatus, r.kycStatus)));
    this.realtime.publish({ type: 'ops', data: { riderId: userId } }, { admins: true });
    return this.view(userId);
  }

  // ── admin ────────────────────────────────────────────────────────────────────

  private row(
    r: typeof riders.$inferSelect,
    u: { name: string | null; phone: string },
  ): AdminKycRow {
    return {
      userId: r.userId,
      fullName: u.name,
      phone: u.phone,
      vehicleType: r.vehicleType,
      plateNumber: r.plateNumber,
      kycStatus: r.kycStatus,
      approvalStatus: r.approvalStatus,
      submittedAt: r.kycSubmittedAt?.toISOString() ?? null,
      reviewedAt: r.kycReviewedAt?.toISOString() ?? null,
    };
  }

  async list(status?: KycStatus): Promise<AdminKycRow[]> {
    const rows = await this.db
      .select({ r: riders, u: { name: users.fullName, phone: users.phoneE164 } })
      .from(riders)
      .innerJoin(users, eq(users.id, riders.userId))
      .where(status ? eq(riders.kycStatus, status) : undefined)
      .orderBy(desc(sql`coalesce(${riders.kycSubmittedAt}, ${riders.createdAt})`))
      .limit(200);
    return rows.map(({ r, u }) => this.row(r, u));
  }

  async detail(adminId: string, riderId: string): Promise<AdminKycDetail> {
    const [found] = await this.db
      .select({
        r: riders,
        u: { name: users.fullName, phone: users.phoneE164, at: users.createdAt },
      })
      .from(riders)
      .innerJoin(users, eq(users.id, riders.userId))
      .where(eq(riders.userId, riderId));
    if (!found) throw new AppError(404, 'NOT_FOUND', 'Rider not found.');
    const caps = await this.captures(riderId);
    const history = await this.db
      .select({
        action: adminAuditLog.action,
        at: adminAuditLog.createdAt,
        by: users.fullName,
        details: adminAuditLog.details,
      })
      .from(adminAuditLog)
      .leftJoin(users, eq(users.id, adminAuditLog.actorId))
      .where(
        and(
          eq(adminAuditLog.targetType, 'rider'),
          eq(adminAuditLog.targetId, riderId),
          sql`${adminAuditLog.action} like 'kyc.%' and ${adminAuditLog.action} <> 'kyc.view'`,
        ),
      )
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(20);
    // Who looked at someone's identity documents is itself worth recording.
    await audit(this.db, adminId, 'kyc.view', { type: 'rider', id: riderId });
    return {
      ...this.row(found.r, found.u),
      reason: found.r.kycReason,
      retake: found.r.kycRetake,
      required: kycRequiredKinds(found.r.vehicleType),
      captured: caps.map((c) => ({
        kind: c.kind,
        capturedAt: c.capturedAt?.toISOString() ?? null,
        uploadedAt: c.createdAt.toISOString(),
      })),
      accountCreatedAt: found.u.at.toISOString(),
      history: history.map((h) => ({
        action: h.action,
        at: h.at.toISOString(),
        by: h.by,
        reason: (h.details as { reason?: string } | null)?.reason ?? null,
      })),
    };
  }

  /** Decrypted photo for an admin's browser. Never cached, never public. */
  async image(riderId: string, kind: KycDocumentKind): Promise<{ data: Buffer; mime: string }> {
    const [doc] = await this.db
      .select()
      .from(kycDocuments)
      .where(and(eq(kycDocuments.riderId, riderId), eq(kycDocuments.kind, kind)));
    if (!doc) throw new AppError(404, 'NOT_FOUND', 'No photo.');
    return { data: this.decrypt(doc, `${riderId}:${kind}`), mime: doc.mime };
  }

  async decide(
    adminId: string,
    riderId: string,
    input: z.output<typeof adminKycDecisionSchema>,
  ): Promise<void> {
    const r = await this.db.select().from(riders).where(eq(riders.userId, riderId));
    const current = r[0];
    if (!current) throw new AppError(404, 'NOT_FOUND', 'Rider not found.');
    if (current.kycStatus !== 'pending_review') {
      throw new AppError(409, 'INVALID_DECISION', 'Only submitted applications can be reviewed.');
    }
    const now = this.clock.now();
    const required = kycRequiredKinds(current.vehicleType);
    await this.db.transaction(async (tx) => {
      const base = { kycReviewedAt: now, kycReviewedBy: adminId, updatedAt: now };
      if (input.decision === 'approve') {
        // KYC approval is what lets a rider work: approve the account in the same step.
        const approveAccount =
          current.approvalStatus === 'pending' || current.approvalStatus === 'rejected';
        await tx
          .update(riders)
          .set({
            ...base,
            kycStatus: 'approved',
            kycReason: null,
            kycRetake: [],
            ...(approveAccount
              ? {
                  approvalStatus: 'approved' as const,
                  reviewedBy: adminId,
                  reviewedAt: now,
                  rejectionReason: null,
                }
              : {}),
          })
          .where(and(eq(riders.userId, riderId), eq(riders.kycStatus, 'pending_review')));
      } else if (input.decision === 'reject') {
        // The rider starts again; the rejected photos aren't kept.
        await tx.delete(kycDocuments).where(eq(kycDocuments.riderId, riderId));
        await tx
          .update(riders)
          .set({ ...base, kycStatus: 'rejected', kycReason: input.reason!, kycRetake: [] })
          .where(and(eq(riders.userId, riderId), eq(riders.kycStatus, 'pending_review')));
      } else {
        const retake = (input.retake ?? []).filter((k) => required.includes(k));
        if (!retake.length) {
          throw new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid.', {
            fields: { retake: 'Pick the photos to retake.' },
          });
        }
        await tx
          .delete(kycDocuments)
          .where(and(eq(kycDocuments.riderId, riderId), inArray(kycDocuments.kind, retake)));
        await tx
          .update(riders)
          .set({
            ...base,
            kycStatus: 'resubmission_required',
            kycReason: input.reason!,
            kycRetake: retake,
          })
          .where(and(eq(riders.userId, riderId), eq(riders.kycStatus, 'pending_review')));
      }
      await audit(
        tx,
        adminId,
        `kyc.${input.decision}`,
        { type: 'rider', id: riderId },
        {
          reason: input.reason ?? null,
          retake: input.retake ?? [],
        },
      );
    });
    this.realtime.notifyUser(riderId, 'rider', { kyc: input.decision });
    this.realtime.publish({ type: 'ops', data: { riderId } }, { admins: true });
  }

  /**
   * Retention: photos are deleted KYC_RETENTION_DAYS after the decision, and drafts that were never
   * submitted are deleted after the same time. Returns how many photos were removed.
   */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - this.retentionDays * DAY_MS);
    const expired = this.db
      .select({ id: riders.userId })
      .from(riders)
      .where(
        or(
          and(
            inArray(riders.kycStatus, ['approved', 'rejected']),
            lt(riders.kycReviewedAt, cutoff),
          ),
          inArray(riders.kycStatus, ['not_submitted', 'resubmission_required']),
        ),
      );
    const removed = await this.db
      .delete(kycDocuments)
      .where(
        and(
          inArray(kycDocuments.riderId, expired),
          // Open drafts: only photos untouched for the whole retention period.
          or(
            sql`${kycDocuments.riderId} in (select user_id from riders where kyc_status in ('approved','rejected'))`,
            lt(kycDocuments.createdAt, cutoff),
          ),
        ),
      )
      .returning({ id: kycDocuments.riderId });
    return removed.length;
  }
}

function badImageThrow(msg: string): never {
  throw badImage(msg);
}
