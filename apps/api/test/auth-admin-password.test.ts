// Admin username/password sign-in: success, generic failures, role/status checks, rate limits.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminCredentials, users } from '../src/db/schema.ts';
import { hashPassword, verifyPassword } from '../src/modules/auth/crypto.ts';
import { createTestApp, sessionCookie, type TestApp } from './helpers.ts';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(() => t.close());

const PASSWORD = 'correct horse battery';

async function makeAdmin(username = 'ops', role: 'admin' | 'customer' = 'admin') {
  const [user] = await t.database.db
    .insert(users)
    .values({ phoneE164: '+251911000111', role, fullName: 'Ops Lead' })
    .returning();
  await t.database.db
    .insert(adminCredentials)
    .values({ userId: user!.id, username, passwordHash: await hashPassword(PASSWORD) });
  return user!;
}

const login = (username: string, password: string, ip = '10.0.0.1') =>
  t.post('/api/auth/admin/login', { username, password }, {}, ip);

describe('password hashing', () => {
  it('verifies the right password only, with a fresh salt each time', async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).not.toBe(b);
    expect(a).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword('wrong', a)).toBe(false);
    expect(await verifyPassword(PASSWORD, 'garbage')).toBe(false);
  });
});

describe('POST /auth/admin/login', () => {
  it('signs an admin in and the cookie restores the session', async () => {
    await makeAdmin();
    const res = await login('OPS', PASSWORD); // usernames are case-insensitive
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe('admin');
    const me = await t.get('/api/auth/me', { cookie: sessionCookie(res) });
    expect(me.json().fullName).toBe('Ops Lead');
  });

  it('gives the same error for a wrong password and an unknown username', async () => {
    await makeAdmin();
    const wrong = await login('ops', 'nope nope nope');
    const unknown = await login('nobody', PASSWORD);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.cookies.find((c) => c.name === 'sid')).toBeUndefined();
  });

  it('refuses accounts that are no longer admins, or are suspended', async () => {
    const user = await makeAdmin();
    await t.database.db.update(users).set({ role: 'customer' }).where(eq(users.id, user.id));
    expect((await login('ops', PASSWORD)).statusCode).toBe(401);
    await t.database.db
      .update(users)
      .set({ role: 'admin', status: 'suspended' })
      .where(eq(users.id, user.id));
    expect((await login('ops', PASSWORD)).statusCode).toBe(401);
  });

  it('limits guesses per username, even from many addresses', async () => {
    await makeAdmin();
    for (let i = 0; i < 5; i++) expect((await login('ops', 'bad', `10.0.1.${i}`)).statusCode).toBe(401);
    const blocked = await login('ops', PASSWORD, '10.0.2.1');
    expect(blocked.statusCode).toBe(429);
    t.clock.advanceSeconds(901);
    expect((await login('ops', PASSWORD, '10.0.2.1')).statusCode).toBe(200);
  });

  it('an admin with a password can no longer sign in with an SMS code', async () => {
    await makeAdmin();
    const req = await t.post('/api/auth/otp/request', { phone: '0911000111' });
    const res = await t.post('/api/auth/otp/verify', {
      challengeId: req.json().challengeId,
      code: t.sms.lastCodeFor('+251911000111'),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('USE_PASSWORD');
  });

  it('limits attempts per address across usernames', async () => {
    for (let i = 0; i < 20; i++) await login(`user${i}`, 'bad');
    expect((await login('another', 'bad')).statusCode).toBe(429);
  });
});

describe('POST /auth/admin/password', () => {
  const NEW = 'a brand new passphrase';

  it('changes the password, keeps this session and signs out the others', async () => {
    await makeAdmin();
    const here = sessionCookie(await login('ops', PASSWORD));
    const other = sessionCookie(await login('ops', PASSWORD, '10.0.0.2'));
    const res = await t.post(
      '/api/auth/admin/password',
      { currentPassword: PASSWORD, newPassword: NEW },
      { cookie: here },
    );
    expect(res.statusCode).toBe(204);
    expect((await t.get('/api/auth/me', { cookie: here })).statusCode).toBe(200);
    expect((await t.get('/api/auth/me', { cookie: other })).statusCode).toBe(401);
    expect((await login('ops', PASSWORD)).statusCode).toBe(401);
    expect((await login('ops', NEW)).statusCode).toBe(200);
  });

  it('requires the right current password and a valid new one', async () => {
    await makeAdmin();
    const cookie = sessionCookie(await login('ops', PASSWORD));
    const wrong = await t.post(
      '/api/auth/admin/password',
      { currentPassword: 'not it at all', newPassword: NEW },
      { cookie },
    );
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.fields.currentPassword).toBeDefined();
    const short = await t.post(
      '/api/auth/admin/password',
      { currentPassword: PASSWORD, newPassword: 'short' },
      { cookie },
    );
    expect(short.json().error.fields.newPassword).toBeDefined();
  });

  it('is only for signed-in admins', async () => {
    const res = await t.post('/api/auth/admin/password', {
      currentPassword: PASSWORD,
      newPassword: NEW,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('recovery phone, 2-step and forgot password', () => {
  const RECOVERY = '+251922334455';

  async function signedInAdmin() {
    await makeAdmin();
    return sessionCookie(await login('ops', PASSWORD));
  }
  async function addRecoveryPhone(cookie: string) {
    const start = await t.post('/api/auth/admin/recovery-phone', { phone: '0922334455' }, { cookie });
    expect(start.statusCode).toBe(200);
    const res = await t.post(
      '/api/auth/admin/recovery-phone/confirm',
      { challengeId: start.json().challengeId, code: t.sms.lastCodeFor(RECOVERY) },
      { cookie },
    );
    expect(res.statusCode).toBe(204);
  }

  it('adds a recovery phone only with the right code', async () => {
    const cookie = await signedInAdmin();
    const start = await t.post('/api/auth/admin/recovery-phone', { phone: '0922334455' }, { cookie });
    const wrong = await t.post(
      '/api/auth/admin/recovery-phone/confirm',
      { challengeId: start.json().challengeId, code: '000000' },
      { cookie },
    );
    expect(wrong.statusCode).toBe(400);
    await addRecoveryPhone(cookie);
    const sec = (await t.get('/api/auth/admin/security', { cookie })).json();
    expect(sec).toMatchObject({ username: 'ops', twoStep: false });
    expect(sec.recoveryPhone).toContain('55');
  });

  it('2-step needs a phone, then asks for a code after the password', async () => {
    const cookie = await signedInAdmin();
    expect(
      (await t.post('/api/auth/admin/two-step', { enabled: true }, { cookie })).statusCode,
    ).toBe(409);
    await addRecoveryPhone(cookie);
    expect(
      (await t.post('/api/auth/admin/two-step', { enabled: true }, { cookie })).statusCode,
    ).toBe(204);

    t.clock.advanceSeconds(120); // past the SMS resend cooldown
    const first = await login('ops', PASSWORD, '10.0.0.9');
    expect(first.statusCode).toBe(200);
    expect(first.cookies.find((c) => c.name === 'sid')).toBeUndefined();
    const { challengeId, ticket, twoStep } = first.json();
    expect(twoStep).toBe(true);

    const forged = await t.post('/api/auth/admin/login/verify', {
      ticket: `${ticket.split('.')[0]}.forged-signature`,
      challengeId,
      code: t.sms.lastCodeFor(RECOVERY),
    });
    expect(forged.statusCode).toBe(400);

    const ok = await t.post('/api/auth/admin/login/verify', {
      ticket,
      challengeId,
      code: t.sms.lastCodeFor(RECOVERY),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.role).toBe('admin');
  });

  it('resets a forgotten password with a code sent to the recovery phone', async () => {
    const cookie = await signedInAdmin();
    await addRecoveryPhone(cookie);
    t.clock.advanceSeconds(120);

    const sentBefore = t.sms.sent.length;
    const unknown = await t.post('/api/auth/admin/forgot', { username: 'nobody' });
    expect(unknown.statusCode).toBe(200);
    expect(t.sms.sent.length).toBe(sentBefore);

    const forgot = await t.post('/api/auth/admin/forgot', { username: 'ops' });
    const NEWPW = 'reset by sms code';
    const reset = await t.post('/api/auth/admin/reset', {
      username: 'ops',
      challengeId: forgot.json().challengeId,
      code: t.sms.lastCodeFor(RECOVERY),
      newPassword: NEWPW,
    });
    expect(reset.statusCode).toBe(204);
    expect((await t.get('/api/auth/me', { cookie })).statusCode).toBe(401);
    expect((await login('ops', PASSWORD, '10.0.0.7')).statusCode).toBe(401);
    expect((await login('ops', NEWPW, '10.0.0.7')).statusCode).toBe(200);
  });
});
