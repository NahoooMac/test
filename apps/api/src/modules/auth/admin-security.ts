// Admin account security: a verified recovery phone, optional 2-step sign-in, and password reset
// by SMS code. Codes reuse the phone OTP service, so the same send limits and lockouts apply.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import {
  adminConfirmCodeBodySchema,
  adminForgotBodySchema,
  adminRecoveryPhoneBodySchema,
  adminResetBodySchema,
  adminTwoStepBodySchema,
  adminTwoStepVerifyBodySchema,
  maskPhone,
  type AdminForgotResponse,
  type AdminSecurity,
  type OtpChallenge,
  type OtpVerifyResponse,
} from '@dp/shared';
import type { Config } from '../../config/env.ts';
import { adminCredentials, sessions as sessionsTable, users } from '../../db/schema.ts';
import { AppError, forbidden, parseInput, tooManyRequests } from '../../shared/errors.ts';
import { consume } from '../../shared/rate-limit.ts';
import { audit } from '../admin/audit.ts';
import { hashPassword } from './crypto.ts';
import { setSessionCookie, toCurrentUser } from './http.ts';
import type { AuthRouteDeps } from './routes.ts';

const context = (req: FastifyRequest) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

const mac = (config: Config, userId: string, challengeId: string) =>
  createHmac('sha256', config.OTP_HMAC_SECRET)
    .update(`admin-2step:${userId}:${challengeId}`)
    .digest('base64url');

/** Ties a 2-step code to the password check that started it: `userId.mac`. */
export function twoStepTicket(config: Config, userId: string, challengeId: string): string {
  return `${userId}.${mac(config, userId, challengeId)}`;
}

function readTicket(config: Config, ticket: string, challengeId: string): string | null {
  const [userId, given] = ticket.split('.');
  if (!userId || !given) return null;
  const want = Buffer.from(mac(config, userId, challengeId));
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got) ? userId : null;
}

const badCode = () => new AppError(400, 'INVALID_CODE', 'That code is not correct or has expired.');

export async function adminSecurityRoutes(app: FastifyInstance, deps: AuthRouteDeps) {
  const { db, config, clock, otp, sessions, auth } = deps;

  async function requireAdmin(req: FastifyRequest, reply: Parameters<typeof auth.require>[1]) {
    const r = await auth.require(req, reply);
    if (r.user.role !== 'admin') throw forbidden();
    const [cred] = await db
      .select()
      .from(adminCredentials)
      .where(eq(adminCredentials.userId, r.user.id));
    if (!cred) throw new AppError(409, 'NO_PASSWORD', 'This account has no password yet.');
    return { ...r, cred };
  }

  // â”€â”€ 2-step sign-in, second half â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.post('/auth/admin/login/verify', async (req, reply): Promise<OtpVerifyResponse> => {
    const body = parseInput(adminTwoStepVerifyBodySchema, req.body);
    const userId = readTicket(config, body.ticket, body.challengeId);
    if (!userId) throw badCode();
    const phone = await otp.confirm(body.challengeId, body.code, context(req));
    const [row] = await db
      .select({ cred: adminCredentials, user: users })
      .from(adminCredentials)
      .innerJoin(users, eq(users.id, adminCredentials.userId))
      .where(eq(adminCredentials.userId, userId));
    if (
      !row ||
      row.cred.recoveryPhone !== phone ||
      row.user.role !== 'admin' ||
      row.user.status !== 'active'
    ) {
      throw badCode();
    }
    const session = await sessions.create(db, row.user, context(req));
    setSessionCookie(reply, config, session.token, session.expiresAt);
    return { user: toCurrentUser(row.user), needsProfile: !row.user.fullName };
  });

  // â”€â”€ Settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.get('/auth/admin/security', async (req, reply): Promise<AdminSecurity> => {
    const { cred } = await requireAdmin(req, reply);
    reply.header('Cache-Control', 'no-store');
    return {
      username: cred.username,
      recoveryPhone: cred.recoveryPhone ? maskPhone(cred.recoveryPhone) : null,
      twoStep: cred.twoStep,
    };
  });

  // Step 1: send a code to the phone being added.
  app.post('/auth/admin/recovery-phone', async (req, reply): Promise<OtpChallenge> => {
    await requireAdmin(req, reply);
    const body = parseInput(adminRecoveryPhoneBodySchema, req.body);
    return otp.request(body.phone, context(req));
  });

  // Step 2: the right code proves the admin holds that phone; save it.
  app.post('/auth/admin/recovery-phone/confirm', async (req, reply) => {
    const { user } = await requireAdmin(req, reply);
    const body = parseInput(adminConfirmCodeBodySchema, req.body);
    const phone = await otp.confirm(body.challengeId, body.code, context(req));
    await db
      .update(adminCredentials)
      .set({ recoveryPhone: phone })
      .where(eq(adminCredentials.userId, user.id));
    await audit(
      db,
      user.id,
      'admin.recovery_phone_set',
      { type: 'user', id: user.id },
      { phone: maskPhone(phone) },
    );
    return reply.status(204).send();
  });

  app.post('/auth/admin/two-step', async (req, reply) => {
    const { user, cred } = await requireAdmin(req, reply);
    const body = parseInput(adminTwoStepBodySchema, req.body);
    if (body.enabled && !cred.recoveryPhone) {
      throw new AppError(409, 'NO_RECOVERY_PHONE', 'Add and verify a phone number first.');
    }
    await db
      .update(adminCredentials)
      .set({ twoStep: body.enabled })
      .where(eq(adminCredentials.userId, user.id));
    await audit(db, user.id, body.enabled ? 'admin.two_step_on' : 'admin.two_step_off', {
      type: 'user',
      id: user.id,
    });
    return reply.status(204).send();
  });

  // â”€â”€ Forgot password â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // The answer looks the same for unknown usernames and admins without a phone (no enumeration).
  app.post('/auth/admin/forgot', async (req): Promise<AdminForgotResponse> => {
    const body = parseInput(adminForgotBodySchema, req.body);
    const limit = await consume(
      db,
      { key: `pwforgot:user1h:${body.username}`, windowSec: 3600, limit: 3 },
      clock.now(),
    );
    if (!limit.allowed) throw tooManyRequests(limit.retryAfterSec);
    const [cred] = await db
      .select({ phone: adminCredentials.recoveryPhone })
      .from(adminCredentials)
      .where(eq(adminCredentials.username, body.username));
    if (!cred?.phone) return { challengeId: randomUUID() };
    const ch = await otp.request(cred.phone, context(req));
    return { challengeId: ch.challengeId };
  });

  app.post('/auth/admin/reset', async (req, reply) => {
    const body = parseInput(adminResetBodySchema, req.body);
    const phone = await otp.confirm(body.challengeId, body.code, context(req));
    const [cred] = await db
      .select()
      .from(adminCredentials)
      .where(eq(adminCredentials.username, body.username));
    if (!cred || cred.recoveryPhone !== phone) throw badCode();
    const now = clock.now();
    const passwordHash = await hashPassword(body.newPassword);
    await db.transaction(async (tx) => {
      await tx
        .update(adminCredentials)
        .set({ passwordHash, passwordChangedAt: now })
        .where(eq(adminCredentials.userId, cred.userId));
      // Whoever had the old password is signed out everywhere.
      await tx
        .update(sessionsTable)
        .set({ revokedAt: now, revokeReason: 'password_reset' })
        .where(
          sql`${sessionsTable.userId} = ${cred.userId} and ${sessionsTable.revokedAt} is null`,
        );
      await audit(
        tx,
        cred.userId,
        'admin.password_reset_by_sms',
        { type: 'user', id: cred.userId },
        {
          ip: req.ip,
        },
      );
    });
    return reply.status(204).send();
  });
}
