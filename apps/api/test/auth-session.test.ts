// Persistent sessions: restore without OTP, sliding expiry, logout, revocation, suspension.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { sessions, users } from '../src/db/schema.ts';
import { createTestApp, signIn, type TestApp } from './helpers.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const me = (cookie?: string) => t.get('/api/auth/me', cookie ? { cookie } : {});
const DAY = 86_400;

describe('session restore', () => {
  it('GET /me returns the user from the cookie, without sending any SMS', async () => {
    const { cookie } = await signIn(t);
    const sentBefore = t.sms.sent.length;
    const res = await me(cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().phone).toBe('+251911234567');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(t.sms.sent.length).toBe(sentBefore);
  });

  it('survives an API restart (state lives in Postgres, not memory)', async () => {
    const { cookie } = await signIn(t);
    const { database, clock } = t;
    await t.close(true);
    t = await createTestApp({ database, clock });
    expect((await me(cookie)).statusCode).toBe(200);
  });

  it('rejects missing, malformed and unknown tokens', async () => {
    expect((await me()).statusCode).toBe(401);
    expect((await me('sid=short')).statusCode).toBe(401);
    expect((await me(`sid=${'x'.repeat(43)}`)).statusCode).toBe(401);
  });

  it('stores only a hash of the session token', async () => {
    const { cookie } = await signIn(t);
    const token = cookie.split('=')[1]!;
    const rows = await t.database.db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(token);
  });
});

describe('expiry', () => {
  it('expires after 30 idle days', async () => {
    const { cookie } = await signIn(t);
    t.clock.advanceSeconds(30 * DAY + 1);
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('activity slides the idle expiry and re-issues the cookie', async () => {
    const { cookie } = await signIn(t);
    t.clock.advanceSeconds(20 * DAY);
    const res = await me(cookie);
    expect(res.statusCode).toBe(200);
    const reissued = res.cookies.find((c) => c.name === 'sid');
    expect(reissued?.expires!.getTime()).toBe(t.clock.now().getTime() + 30 * DAY * 1000);
    t.clock.advanceSeconds(20 * DAY); // 40 days after sign-in, 20 after last use
    expect((await me(cookie)).statusCode).toBe(200);
  });

  it('does not write on every request (touch at most hourly)', async () => {
    const { cookie } = await signIn(t);
    t.clock.advanceSeconds(60);
    const res = await me(cookie);
    expect(res.cookies.find((c) => c.name === 'sid')).toBeUndefined();
  });

  it('never outlives the 90-day absolute limit, even with daily use', async () => {
    const { cookie } = await signIn(t);
    for (let day = 0; day < 89; day++) {
      t.clock.advanceSeconds(DAY);
      expect((await me(cookie)).statusCode).toBe(200);
    }
    t.clock.advanceSeconds(DAY + 1);
    expect((await me(cookie)).statusCode).toBe(401);
  });
});

describe('logout and revocation', () => {
  it('logout revokes the session server-side and clears the cookie', async () => {
    const { cookie } = await signIn(t);
    const res = await t.post('/api/auth/logout', undefined, { cookie });
    expect(res.statusCode).toBe(204);
    const cleared = res.cookies.find((c) => c.name === 'sid');
    expect(cleared?.value).toBe('');
    // A copied token is useless afterwards.
    expect((await me(cookie)).statusCode).toBe(401);
    const [row] = await t.database.db.select().from(sessions);
    expect(row!.revokeReason).toBe('logout');
  });

  it('logout without a session is harmless', async () => {
    expect((await t.post('/api/auth/logout')).statusCode).toBe(204);
  });

  it('suspending a user ends their sessions', async () => {
    const { cookie, body } = await signIn(t);
    await t.database.db
      .update(users)
      .set({ status: 'suspended' })
      .where(eq(users.id, body.user.id));
    expect((await me(cookie)).statusCode).toBe(401);
    const [row] = await t.database.db.select().from(sessions);
    expect(row!.revokeReason).toBe('user_suspended');
  });

  it('logging out on one device leaves other devices signed in', async () => {
    const phoneA = await signIn(t);
    t.clock.advanceSeconds(3600);
    const phoneB = await signIn(t);
    await t.post('/api/auth/logout', undefined, { cookie: phoneA.cookie });
    expect((await me(phoneA.cookie)).statusCode).toBe(401);
    expect((await me(phoneB.cookie)).statusCode).toBe(200);
  });

  it('logout from another site is blocked', async () => {
    const { cookie } = await signIn(t);
    const res = await t.post('/api/auth/logout', undefined, {
      cookie,
      origin: 'https://evil.example',
    });
    expect(res.statusCode).toBe(403);
    expect((await me(cookie)).statusCode).toBe(200);
  });
});

describe('profile', () => {
  it('updates name and language', async () => {
    const { cookie } = await signIn(t);
    const res = await t.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: { cookie, origin: 'http://localhost:5173' },
      payload: { fullName: '  Hana Bekele ', preferredLanguage: 'am' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ fullName: 'Hana Bekele', preferredLanguage: 'am' });
  });

  it('requires a session and valid input', async () => {
    const anon = await t.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: { origin: 'http://localhost:5173' },
      payload: { fullName: 'X' },
    });
    expect(anon.statusCode).toBe(401);
    const { cookie } = await signIn(t);
    const bad = await t.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: { cookie, origin: 'http://localhost:5173' },
      payload: { fullName: 'X', role: 'admin' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('cannot escalate role through the profile endpoint', async () => {
    const { cookie } = await signIn(t);
    await t.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: { cookie, origin: 'http://localhost:5173' },
      payload: { fullName: 'Hana', role: 'admin' },
    });
    expect((await me(cookie)).json().role).toBe('customer');
  });
});

describe('admin sessions', () => {
  it('are short-lived (12 hours)', async () => {
    const { body } = await signIn(t);
    await t.database.db.update(users).set({ role: 'admin' }).where(eq(users.id, body.user.id));
    t.clock.advanceSeconds(3600);
    const admin = await signIn(t);
    t.clock.advanceSeconds(12 * 3600 + 1);
    expect((await me(admin.cookie)).statusCode).toBe(401);
  });
});
