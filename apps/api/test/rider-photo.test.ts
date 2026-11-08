// Rider profile photo: the approved KYC front face, visible only to people with a reason to see it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { riderPhotos, riders, users } from '../src/db/schema.ts';
import { createTestApp, ORIGIN, signIn, submitKyc, type TestApp } from './helpers.ts';

let t: TestApp;
let n = 0;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const MESKEL = { lat: 9.0105, lng: 38.7614 };
const PIASSA = { lat: 9.0326, lng: 38.7541 };

const call = (method: 'GET' | 'POST', url: string, cookie: string, payload?: unknown, headers: Record<string, string> = {}) =>
  t.app.inject({ method, url, headers: { cookie, origin: ORIGIN, ...headers }, ...(payload ? { payload: payload as object } : {}) });

async function admin() {
  const s = await signIn(t, `09570${String(++n).padStart(5, '0')}`, `10.95.0.${n}`);
  await t.database.db.update(users).set({ role: 'admin' }).where(eq(users.id, s.body.user.id));
  return { id: s.body.user.id as string, cookie: s.cookie };
}
async function customer() {
  const s = await signIn(t, `09140${String(++n).padStart(5, '0')}`, `10.95.1.${n}`);
  return { id: s.body.user.id as string, cookie: s.cookie };
}
/** A rider who went through KYC; approved by `a` unless told otherwise. */
async function verifiedRider(a: { cookie: string }, decision: 'approve' | 'reject' = 'approve') {
  const s = await signIn(t, `09470${String(++n).padStart(5, '0')}`, `10.95.2.${n}`);
  await call('POST', '/api/rider/apply', s.cookie, { fullName: 'Photo Rider', vehicleType: 'bicycle' });
  await submitKyc(t, s.cookie);
  const id = s.body.user.id as string;
  const res = await call('POST', `/api/admin/riders/${id}/kyc/decision`, a.cookie, {
    decision,
    ...(decision === 'reject' ? { reason: 'Blurry ID' } : {}),
  });
  expect(res.statusCode).toBe(204);
  return { id, cookie: s.cookie };
}

describe('profile photo from KYC', () => {
  it('approval copies the front-face capture into the rider profile photo', async () => {
    const a = await admin();
    const r = await verifiedRider(a);
    const [row] = await t.database.db.select().from(riders).where(eq(riders.userId, r.id));
    expect(row!.photoUpdatedAt).not.toBeNull();
    const profile = (await call('GET', '/api/rider/home', r.cookie)).json().profile;
    expect(profile.photoUrl).toMatch(new RegExp(`^/api/riders/${r.id}/photo\\?v=\\d+$`));
    const img = await call('GET', profile.photoUrl, r.cookie);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toContain('image/jpeg');
    expect(img.rawPayload.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    // The admin sees it too, on both lists.
    expect((await call('GET', profile.photoUrl, a.cookie)).statusCode).toBe(200);
    const list = (await call('GET', '/api/admin/riders', a.cookie)).json();
    expect(list.find((x: { userId: string }) => x.userId === r.id).photoUrl).toBe(profile.photoUrl);
    const usersList = (await call('GET', '/api/admin/users', a.cookie)).json();
    expect(usersList.find((u: { id: string }) => u.id === r.id)).toMatchObject({ kycStatus: 'approved', photoUrl: profile.photoUrl });
    expect(usersList.find((u: { id: string }) => u.id === a.id)).toMatchObject({ kycStatus: null, photoUrl: null });
  });

  it('backfills riders approved before profile photos existed, once', async () => {
    const a = await admin();
    const r = await verifiedRider(a);
    // As if approved before this feature: no photo row, no photo time.
    await t.database.db.delete(riderPhotos).where(eq(riderPhotos.riderId, r.id));
    await t.database.db.update(riders).set({ photoUpdatedAt: null }).where(eq(riders.userId, r.id));
    expect((await call('GET', '/api/rider/home', r.cookie)).json().profile.photoUrl).toBeNull();

    const first = await t.kyc.backfillProfilePhotos();
    expect(first).toEqual({ filled: [r.id], missingFace: [] });
    const url = (await call('GET', '/api/rider/home', r.cookie)).json().profile.photoUrl;
    expect((await call('GET', url, r.cookie)).statusCode).toBe(200);
    expect(await t.kyc.backfillProfilePhotos()).toEqual({ filled: [], missingFace: [] });
  });

  it('a rejected application gets no profile photo', async () => {
    const a = await admin();
    const r = await verifiedRider(a, 'reject');
    expect(await t.database.db.select().from(riderPhotos).where(eq(riderPhotos.riderId, r.id))).toHaveLength(0);
    expect((await call('GET', '/api/rider/home', r.cookie)).json().profile.photoUrl).toBeNull();
  });

  it('only the customer of that rider’s delivery, and the tracking page while on the job, can see it', async () => {
    const a = await admin();
    const r = await verifiedRider(a);
    await call('POST', '/api/rider/status', r.cookie, { online: true });
    await call('POST', '/api/rider/location', r.cookie, MESKEL);
    const c = await customer();
    const stranger = await customer();
    const url = `/api/riders/${r.id}/photo`;
    expect((await call('GET', url, c.cookie)).statusCode).toBe(404);

    const res = await call(
      'POST',
      '/api/deliveries',
      c.cookie,
      {
        pickup: { ...MESKEL, address: 'Meskel Square', contactName: 'Hana', contactPhone: '0911111111' },
        dropoff: { ...PIASSA, address: 'Piassa', contactName: 'Abel', contactPhone: '0922222222' },
        vehicleType: 'bicycle',
        payer: 'sender',
        preferredPaymentMethod: 'cash',
        parcel: { description: 'Docs', size: 'small' },
      },
      { 'idempotency-key': 'photo-key-1' },
    );
    const d = res.json();
    const offer = (await call('GET', '/api/rider/home', r.cookie)).json().offer;
    expect((await call('POST', `/api/rider/offers/${offer.id}/accept`, r.cookie)).statusCode).toBe(200);

    const view = (await call('GET', `/api/deliveries/${d.id}`, c.cookie)).json();
    expect(view.rider.photoUrl).toMatch(new RegExp(`^${url}\\?v=\\d+$`));
    expect((await call('GET', view.rider.photoUrl, c.cookie)).statusCode).toBe(200);
    expect((await call('GET', url, stranger.cookie)).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url })).statusCode).toBe(401);

    const pub = (await t.get(`/api/track/${d.code}`)).json();
    expect(pub.rider.photoUrl).toMatch(new RegExp(`^/api/track/${d.code}/rider-photo\\?v=\\d+$`));
    expect((await t.get(pub.rider.photoUrl)).statusCode).toBe(200);

    // Once the job is over, the tracking page no longer shows the rider's face.
    for (const s of ['arrived_pickup', 'picked_up', 'arrived_dropoff']) {
      await call('POST', `/api/rider/jobs/${d.id}/step`, r.cookie, { to: s });
    }
    await call('POST', `/api/rider/jobs/${d.id}/complete`, r.cookie, { handoverConfirmed: true, paymentReceived: true });
    expect((await t.get(`/api/track/${d.code}`)).json().rider.photoUrl).toBeNull();
    expect((await t.get(`/api/track/${d.code}/rider-photo`)).statusCode).toBe(404);
  });
});
