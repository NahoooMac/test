// Rider KYC: live-capture uploads, encryption at rest, admin-only access, review decisions,
// resubmission, the job gate (enforced by the database), and retention.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminAuditLog, kycDocuments, riders, users } from '../src/db/schema.ts';
import { jpegSize } from '../src/modules/kyc/service.ts';
import { createTestApp, fakeJpeg, ORIGIN, signIn, submitKyc, type TestApp } from './helpers.ts';

let t: TestApp;
let ip = 0;
const nextIp = () => `10.40.0.${++ip}`;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const req = (method: 'GET' | 'POST' | 'PUT', url: string, cookie?: string, payload?: unknown) =>
  t.app.inject({
    method,
    url,
    headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

async function applicant(vehicle: 'motorcycle' | 'bicycle' = 'motorcycle', phone = '0944500001') {
  const s = await signIn(t, phone, nextIp());
  const res = await req('POST', '/api/rider/apply', s.cookie, {
    fullName: 'Abebe Bikila',
    vehicleType: vehicle,
    ...(vehicle === 'motorcycle' ? { plateNumber: '3-A12345' } : {}),
  });
  expect(res.statusCode).toBe(201);
  return { id: s.body.user.id as string, cookie: s.cookie };
}

async function admin(phone = '0955500001') {
  const s = await signIn(t, phone, nextIp());
  await t.database.db.update(users).set({ role: 'admin' }).where(eq(users.id, s.body.user.id));
  return { id: s.body.user.id as string, cookie: s.cookie };
}

const upload = (cookie: string, kind: string, image = fakeJpeg()) =>
  req('PUT', `/api/rider/kyc/documents/${kind}`, cookie, { image });
const decide = (a: { cookie: string }, riderId: string, body: object) =>
  req('POST', `/api/admin/riders/${riderId}/kyc/decision`, a.cookie, body);

describe('capture and submit', () => {
  it('starts not submitted, with licence and plate only for motor vehicles', async () => {
    const moto = await applicant('motorcycle');
    const kyc = (await req('GET', '/api/rider/kyc', moto.cookie)).json();
    expect(kyc.status).toBe('not_submitted');
    expect(kyc.required).toEqual([
      'license',
      'plate',
      'id_front',
      'id_back',
      'face_front',
      'face_left',
      'face_right',
    ]);
    const bike = await applicant('bicycle', '0944500002');
    const bikeKyc = (await req('GET', '/api/rider/kyc', bike.cookie)).json();
    expect(bikeKyc.required).not.toContain('license');
    expect((await upload(bike.cookie, 'plate')).statusCode).toBe(400);
  });

  it('accepts only real, decent-size JPEGs', async () => {
    const r = await applicant();
    const png = Buffer.alloc(20_000);
    png.set([0x89, 0x50, 0x4e, 0x47]);
    expect((await upload(r.cookie, 'id_front', png.toString('base64'))).statusCode).toBe(400);
    expect((await upload(r.cookie, 'id_front', fakeJpeg(1280, 960, 2000))).statusCode).toBe(400);
    expect((await upload(r.cookie, 'id_front', fakeJpeg(200, 150))).statusCode).toBe(400);
    expect((await upload(r.cookie, 'id_front', fakeJpeg())).statusCode).toBe(200);
    expect(jpegSize(Buffer.from(fakeJpeg(800, 600), 'base64'))).toEqual({
      width: 800,
      height: 600,
    });
  });

  it('refuses to submit until every required photo is in, then locks the application', async () => {
    const r = await applicant();
    await upload(r.cookie, 'id_front');
    const early = await req('POST', '/api/rider/kyc/submit', r.cookie);
    expect(early.statusCode).toBe(409);
    expect(early.json().error.details.missing).toContain('face_left');

    const kyc = await submitKyc(t, r.cookie);
    expect(kyc.status).toBe('pending_review');
    expect((await upload(r.cookie, 'id_front')).statusCode).toBe(409);
  });

  it('stores photos encrypted, never as the original bytes', async () => {
    const r = await applicant();
    const image = fakeJpeg();
    await upload(r.cookie, 'id_front', image);
    const [row] = await t.database.db
      .select()
      .from(kycDocuments)
      .where(eq(kycDocuments.riderId, r.id));
    expect(row!.ciphertext).not.toBe(image);
    expect(Buffer.from(row!.ciphertext, 'base64').equals(Buffer.from(image, 'base64'))).toBe(false);
  });
});

describe('admin access', () => {
  it('only admins can list, open and view photos; photos are never cached', async () => {
    const r = await applicant();
    await submitKyc(t, r.cookie);
    const a = await admin();
    const customer = await signIn(t, '0911500001', nextIp());

    for (const url of [
      '/api/admin/kyc',
      `/api/admin/riders/${r.id}/kyc`,
      `/api/admin/riders/${r.id}/kyc/id_front`,
    ]) {
      expect((await req('GET', url)).statusCode).toBe(401);
      expect((await req('GET', url, customer.cookie)).statusCode).toBe(403);
      expect((await req('GET', url, r.cookie)).statusCode).toBe(403);
    }

    const list = (await req('GET', '/api/admin/kyc?status=pending_review', a.cookie)).json();
    expect(list.map((x: { userId: string }) => x.userId)).toEqual([r.id]);
    const detail = (await req('GET', `/api/admin/riders/${r.id}/kyc`, a.cookie)).json();
    expect(detail.captured).toHaveLength(7);
    expect(detail.fullName).toBe('Abebe Bikila');

    const img = await req('GET', `/api/admin/riders/${r.id}/kyc/id_front`, a.cookie);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(img.headers['cache-control']).toContain('no-store');
    expect(img.rawPayload.equals(Buffer.from(fakeJpeg(), 'base64'))).toBe(true);

    // Opening someone's documents is audited.
    const views = await t.database.db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, 'kyc.view'));
    expect(views).toHaveLength(1);
  });
});

describe('decisions', () => {
  it('approval verifies the identity and approves the account in one step, with an audit trail', async () => {
    const r = await applicant();
    await submitKyc(t, r.cookie);
    const a = await admin();
    expect((await decide(a, r.id, { decision: 'approve' })).statusCode).toBe(204);
    const [row] = await t.database.db.select().from(riders).where(eq(riders.userId, r.id));
    expect(row).toMatchObject({
      kycStatus: 'approved',
      approvalStatus: 'approved',
      kycReviewedBy: a.id,
    });
    expect(row!.kycReviewedAt).toBeInstanceOf(Date);
    const [log] = await t.database.db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, 'kyc.approve'));
    expect(log!.actorId).toBe(a.id);
    expect(
      (await req('POST', '/api/rider/status', r.cookie, { online: true })).json().isOnline,
    ).toBe(true);
  });

  it('rejection needs a reason, deletes the photos, and lets the rider start again', async () => {
    const r = await applicant();
    await submitKyc(t, r.cookie);
    const a = await admin();
    expect((await decide(a, r.id, { decision: 'reject' })).statusCode).toBe(400);
    expect(
      (await decide(a, r.id, { decision: 'reject', reason: 'ID photo is not yours' })).statusCode,
    ).toBe(204);
    const kyc = (await req('GET', '/api/rider/kyc', r.cookie)).json();
    expect(kyc).toMatchObject({
      status: 'rejected',
      reason: 'ID photo is not yours',
      captured: [],
    });
    expect(await t.database.db.select().from(kycDocuments)).toHaveLength(0);
    expect((await submitKyc(t, r.cookie)).status).toBe('pending_review');
  });

  it('asking for retakes keeps the good photos and requires fresh ones for the rest', async () => {
    const r = await applicant();
    await submitKyc(t, r.cookie);
    const a = await admin();
    const res = await decide(a, r.id, {
      decision: 'resubmit',
      reason: 'Licence is blurry',
      retake: ['license'],
    });
    expect(res.statusCode).toBe(204);
    const kyc = (await req('GET', '/api/rider/kyc', r.cookie)).json();
    expect(kyc).toMatchObject({ status: 'resubmission_required', retake: ['license'] });
    expect(kyc.captured.map((c: { kind: string }) => c.kind)).not.toContain('license');

    expect((await req('POST', '/api/rider/kyc/submit', r.cookie)).statusCode).toBe(409);
    t.clock.advanceSeconds(5);
    expect((await upload(r.cookie, 'license')).statusCode).toBe(200);
    expect((await req('POST', '/api/rider/kyc/submit', r.cookie)).json().status).toBe(
      'pending_review',
    );
  });

  it('only submitted applications can be decided, and only by admins', async () => {
    const r = await applicant();
    const a = await admin();
    expect((await decide(a, r.id, { decision: 'approve' })).statusCode).toBe(409);
    await submitKyc(t, r.cookie);
    expect((await decide(r, r.id, { decision: 'approve' })).statusCode).toBe(403);
  });
});

describe('the job gate', () => {
  it('an unverified rider cannot go online, and the database refuses approval without KYC', async () => {
    const r = await applicant();
    expect((await req('POST', '/api/rider/status', r.cookie, { online: true })).statusCode).toBe(
      403,
    );
    await expect(
      t.database.db
        .update(riders)
        .set({ approvalStatus: 'approved' })
        .where(eq(riders.userId, r.id)),
    ).rejects.toThrow();
  });
});

describe('retention', () => {
  it('deletes photos after the retention period, keeping the decision on record', async () => {
    const r = await applicant();
    await submitKyc(t, r.cookie);
    const a = await admin();
    await decide(a, r.id, { decision: 'approve' });

    expect(await t.kyc.purgeExpired()).toBe(0);
    t.clock.advanceSeconds((t.config.KYC_RETENTION_DAYS + 1) * 86_400);
    expect(await t.kyc.purgeExpired()).toBe(7);
    const [row] = await t.database.db.select().from(riders).where(eq(riders.userId, r.id));
    expect(row!.kycStatus).toBe('approved');
  });

  it('removes abandoned drafts after the retention period', async () => {
    const r = await applicant();
    await upload(r.cookie, 'id_front');
    t.clock.advanceSeconds((t.config.KYC_RETENTION_DAYS + 1) * 86_400);
    expect(await t.kyc.purgeExpired()).toBe(1);
  });
});
