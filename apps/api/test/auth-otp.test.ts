// OTP request/verify: SMS cost controls and abuse protection.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { otpChallenges, smsMessages, users } from '../src/db/schema.ts';
import { SmsSendError } from '../src/integrations/sms/types.ts';
import { createTestApp, signIn, type TestApp } from './helpers.ts';

const PHONE = '+251911234567';
let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const requestOtp = (phone = '0911234567', ip = '127.0.0.1') =>
  t.post('/api/auth/otp/request', { phone }, {}, ip);
const verify = (challengeId: string, code: string, ip = '127.0.0.1') =>
  t.post('/api/auth/otp/verify', { challengeId, code }, {}, ip);
const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

describe('OTP request', () => {
  it('normalizes the phone and sends exactly one SMS', async () => {
    const res = await requestOtp('+251 91 123 4567');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      maskedPhone: '+251 9•• ••• •67',
      resendAfterSec: 60,
      expiresInSec: 300,
    });
    expect(t.sms.countFor(PHONE)).toBe(1);
  });

  it('rejects invalid numbers without sending', async () => {
    const res = await requestOtp('0111234567');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields.phone).toBeDefined();
    expect(t.sms.sent).toHaveLength(0);
  });

  it('reuses the open challenge inside the cooldown and sends no second SMS', async () => {
    const first = (await requestOtp()).json();
    t.clock.advanceSeconds(20);
    const second = (await requestOtp('0911 234 567')).json();
    expect(second.challengeId).toBe(first.challengeId);
    expect(second.resendAfterSec).toBe(40);
    expect(t.sms.countFor(PHONE)).toBe(1);
  });

  it('resends after the cooldown with a new code; the old code stops working', async () => {
    const { challengeId } = (await requestOtp()).json();
    const oldCode = t.sms.lastCodeFor(PHONE);
    t.clock.advanceSeconds(61);
    const again = (await requestOtp()).json();
    expect(again.challengeId).toBe(challengeId);
    expect(t.sms.countFor(PHONE)).toBe(2);
    const newCode = t.sms.lastCodeFor(PHONE);
    if (newCode !== oldCode) {
      expect((await verify(challengeId, oldCode)).statusCode).toBe(400);
    }
    expect((await verify(challengeId, newCode)).statusCode).toBe(200);
  });

  it('concurrent requests for one phone send a single SMS', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => requestOtp()));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(new Set(results.map((r) => r.json().challengeId)).size).toBe(1);
    expect(t.sms.countFor(PHONE)).toBe(1);
  });

  it('limits sends per phone (3 per 15 minutes)', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await requestOtp()).statusCode).toBe(200);
      t.clock.advanceSeconds(61);
    }
    const blocked = await requestOtp();
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(t.sms.countFor(PHONE)).toBe(3);
  });

  it('limits sends per IP across different phones', async () => {
    for (let i = 0; i < 10; i++) {
      expect(
        (await requestOtp(`09110000${String(i).padStart(2, '0')}`, '10.1.1.1')).statusCode,
      ).toBe(200);
    }
    expect((await requestOtp('0911000099', '10.1.1.1')).statusCode).toBe(429);
    // A different IP is unaffected.
    expect((await requestOtp('0911000099', '10.2.2.2')).statusCode).toBe(200);
  });

  it('stops all sends when the daily SMS budget is spent', async () => {
    await t.close();
    t = await createTestApp({ env: { SMS_DAILY_BUDGET: '2' } });
    expect((await requestOtp('0911000001', '10.0.0.1')).statusCode).toBe(200);
    expect((await requestOtp('0911000002', '10.0.0.2')).statusCode).toBe(200);
    const res = await requestOtp('0911000003', '10.0.0.3');
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('SMS_UNAVAILABLE');
    expect(t.sms.sent).toHaveLength(2);
  });

  it('gives the same response shape for new and existing accounts (no enumeration)', async () => {
    await signIn(t, '0911234567');
    t.clock.advanceSeconds(3600);
    const existing = (await requestOtp('0911234567')).json();
    const fresh = (await requestOtp('0922222222')).json();
    expect(Object.keys(existing).sort()).toEqual(Object.keys(fresh).sort());
    expect(existing.resendAfterSec).toBe(fresh.resendAfterSec);
    expect(existing.expiresInSec).toBe(fresh.expiresInSec);
  });

  it('stores only a keyed hash of the code, and no message text', async () => {
    await requestOtp();
    const code = t.sms.lastCodeFor(PHONE);
    const [row] = await t.database.db.select().from(otpChallenges);
    expect(row!.codeHash).not.toContain(code);
    expect(row!.codeHash.length).toBeGreaterThan(30);
    const [msg] = await t.database.db.select().from(smsMessages);
    expect(JSON.stringify(msg)).not.toContain(code);
    expect(msg!.status).toBe('sent');
  });

  it('a definite send failure lets the user retry immediately', async () => {
    t.sms.failNext = new SmsSendError('not_sent', 'HTTP_400', 'rejected');
    const failed = await requestOtp();
    expect(failed.statusCode).toBe(502);
    const retry = await requestOtp();
    expect(retry.statusCode).toBe(200);
    expect(t.sms.countFor(PHONE)).toBe(1);
    const [msg] = await t.database.db
      .select()
      .from(smsMessages)
      .where(eq(smsMessages.status, 'failed'));
    expect(msg!.errorCode).toBe('HTTP_400');
  });

  it('an empty SMS balance says "try later", not "check the number"', async () => {
    t.sms.failNext = new SmsSendError('not_sent', 'AFRO_401-9', 'balance too low');
    const res = await requestOtp();
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('SMS_UNAVAILABLE');
  });

  it('an ambiguous failure (timeout) keeps the cooldown so no duplicate SMS is sent', async () => {
    t.sms.failNext = new SmsSendError('unknown', 'TIMEOUT', 'timeout');
    const first = await requestOtp();
    expect(first.statusCode).toBe(200);
    expect(first.json().resendAfterSec).toBe(60);
    const again = await requestOtp();
    expect(again.json().resendAfterSec).toBe(60);
    expect(t.sms.sent).toHaveLength(0); // the fake recorded nothing; crucially no second attempt
  });

  it('rejects cross-site requests', async () => {
    const res = await t.post(
      '/api/auth/otp/request',
      { phone: '0911234567' },
      { origin: 'https://evil.example' },
    );
    expect(res.statusCode).toBe(403);
    expect(t.sms.sent).toHaveLength(0);
  });
});

describe('OTP verify', () => {
  it('creates the account once and signs in', async () => {
    const { body, res } = await signIn(t);
    expect(body.user).toMatchObject({ phone: PHONE, role: 'customer', status: 'active' });
    expect(body.needsProfile).toBe(true);
    const cookie = res.cookies.find((c) => c.name === 'sid')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.path).toBe('/');
    expect(cookie.expires!.getTime()).toBeGreaterThan(t.clock.now().getTime() + 29 * 86_400_000);
  });

  it('signing in again with the same phone reuses the account', async () => {
    const a = await signIn(t, '0911234567');
    t.clock.advanceSeconds(3600);
    const b = await signIn(t, '+251911234567');
    expect(b.body.user.id).toBe(a.body.user.id);
    expect(await t.database.db.select().from(users)).toHaveLength(1);
  });

  it('a code works only once', async () => {
    const { challengeId } = (await requestOtp()).json();
    const code = t.sms.lastCodeFor(PHONE);
    expect((await verify(challengeId, code)).statusCode).toBe(200);
    expect((await verify(challengeId, code)).statusCode).toBe(400);
  });

  it('concurrent verifications of one code create a single session', async () => {
    const { challengeId } = (await requestOtp()).json();
    const code = t.sms.lastCodeFor(PHONE);
    const results = await Promise.all(Array.from({ length: 4 }, () => verify(challengeId, code)));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
  });

  it('expired codes are rejected', async () => {
    const { challengeId } = (await requestOtp()).json();
    const code = t.sms.lastCodeFor(PHONE);
    t.clock.advanceSeconds(301);
    const res = await verify(challengeId, code);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.expired).toBe(true);
  });

  it('counts down attempts, then locks the phone after 5 wrong codes', async () => {
    const { challengeId } = (await requestOtp()).json();
    const code = t.sms.lastCodeFor(PHONE);
    for (let i = 4; i >= 1; i--) {
      const r = await verify(challengeId, wrongCode(code));
      expect(r.statusCode).toBe(400);
      expect(r.json().error.details.attemptsRemaining).toBe(i);
    }
    const locked = await verify(challengeId, wrongCode(code));
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('AUTH_LOCKED');

    // Even the right code no longer works, and no new SMS can be requested during the lockout.
    expect((await verify(challengeId, code)).statusCode).toBe(400);
    t.clock.advanceSeconds(120);
    expect((await requestOtp()).statusCode).toBe(429);
    expect(t.sms.countFor(PHONE)).toBe(1);

    // After the lockout a new code can be requested.
    t.clock.advanceSeconds(15 * 60);
    expect((await requestOtp()).statusCode).toBe(200);
  });

  it('parallel wrong guesses cannot exceed the attempt limit', async () => {
    const { challengeId } = (await requestOtp()).json();
    const code = t.sms.lastCodeFor(PHONE);
    const guesses = await Promise.all(
      Array.from({ length: 12 }, () => verify(challengeId, wrongCode(code))),
    );
    const [row] = await t.database.db.select().from(otpChallenges);
    expect(row!.attempts).toBeLessThanOrEqual(5);
    expect(guesses.filter((g) => g.statusCode === 400 || g.statusCode === 429)).toHaveLength(12);
  });

  it('limits verify attempts per IP', async () => {
    const { challengeId } = (await requestOtp()).json();
    for (let i = 0; i < 30; i++) await verify(challengeId, '123456', '10.9.9.9');
    expect((await verify(challengeId, '123456', '10.9.9.9')).statusCode).toBe(429);
  });

  it('validates input shape', async () => {
    const res = await t.post('/api/auth/otp/verify', { challengeId: 'nope', code: '12' });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().error.fields).sort()).toEqual(['challengeId', 'code']);
  });

  it('refuses suspended accounts', async () => {
    const { body } = await signIn(t);
    await t.database.db
      .update(users)
      .set({ status: 'suspended' })
      .where(eq(users.id, body.user.id));
    t.clock.advanceSeconds(3600);
    const { challengeId } = (await requestOtp()).json();
    const res = await verify(challengeId, t.sms.lastCodeFor(PHONE));
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ACCOUNT_SUSPENDED');
    expect(res.cookies.find((c) => c.name === 'sid')).toBeUndefined();
  });
});
