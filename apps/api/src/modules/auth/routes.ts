import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, isNull, ne } from 'drizzle-orm';
import {
  adminChangePasswordBodySchema,
  adminLoginBodySchema,
  otpRequestBodySchema,
  otpVerifyBodySchema,
  updateProfileBodySchema,
  type AdminLoginResponse,
  type CurrentUser,
  type OtpChallenge,
  type OtpVerifyResponse,
} from '@dp/shared';
import type { Config } from '../../config/env.ts';
import type { Db } from '../../db/client.ts';
import { adminCredentials, sessions as sessionsTable, users } from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import { AppError, forbidden, parseInput, tooManyRequests } from '../../shared/errors.ts';
import { consume, consumeAll } from '../../shared/rate-limit.ts';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './crypto.ts';
import { clearSessionCookie, setSessionCookie, toCurrentUser, type Authenticator } from './http.ts';
import { audit } from '../admin/audit.ts';
import { adminSecurityRoutes, twoStepTicket } from './admin-security.ts';
import type { OtpService } from './otp-service.ts';
import type { SessionService } from './sessions.ts';

export interface AuthRouteDeps {
  db: Db;
  config: Config;
  clock: Clock;
  otp: OtpService;
  sessions: SessionService;
  auth: Authenticator;
  /** Called after a session is revoked, e.g. to close its live event streams. */
  onSessionRevoked?: (sessionId: string) => void;
}

const context = (req: FastifyRequest) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

export async function authRoutes(app: FastifyInstance, deps: AuthRouteDeps) {
  const { db, config, clock, otp, sessions, auth, onSessionRevoked } = deps;

  app.post('/auth/otp/request', async (req): Promise<OtpChallenge> => {
    const body = parseInput(otpRequestBodySchema, req.body);
    return otp.request(body.phone, context(req));
  });

  app.post('/auth/otp/verify', async (req, reply): Promise<OtpVerifyResponse> => {
    const body = parseInput(otpVerifyBodySchema, req.body);
    const result = await otp.verify(body.challengeId, body.code, context(req));
    setSessionCookie(reply, config, result.token, result.expiresAt);
    return { user: toCurrentUser(result.user), needsProfile: !result.user.fullName };
  });

  // Admin username/password sign-in. One generic error for every failure, so it reveals nothing.
  app.post('/auth/admin/login', async (req, reply): Promise<AdminLoginResponse> => {
    const body = parseInput(adminLoginBodySchema, req.body);
    const now = clock.now();
    const blocked = await consumeAll(
      db,
      [
        { key: `pwlogin:ip15m:${req.ip}`, windowSec: 900, limit: 20 },
        { key: `pwlogin:user15m:${body.username}`, windowSec: 900, limit: 5 },
      ],
      now,
    );
    if (blocked) throw tooManyRequests(blocked.retryAfterSec);

    const [row] = await db
      .select({ cred: adminCredentials, user: users })
      .from(adminCredentials)
      .innerJoin(users, eq(users.id, adminCredentials.userId))
      .where(eq(adminCredentials.username, body.username))
      .limit(1);
    const ok = await verifyPassword(body.password, row?.cred.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!row || !ok || row.user.role !== 'admin' || row.user.status !== 'active') {
      throw new AppError(401, 'BAD_CREDENTIALS', 'Wrong username or password.');
    }

    // 2-step: the password alone is not enough; a code goes to the verified recovery phone.
    if (row.cred.twoStep && row.cred.recoveryPhone) {
      const ch = await otp.request(row.cred.recoveryPhone, context(req));
      return {
        twoStep: true,
        challengeId: ch.challengeId,
        maskedPhone: ch.maskedPhone,
        ticket: twoStepTicket(config, row.user.id, ch.challengeId),
      };
    }

    const session = await sessions.create(db, row.user, context(req));
    setSessionCookie(reply, config, session.token, session.expiresAt);
    return { user: toCurrentUser(row.user), needsProfile: !row.user.fullName };
  });

  await adminSecurityRoutes(app, deps);

  // Signed-in admin changes their own password. Other sessions are signed out; this one stays.
  app.post('/auth/admin/password', async (req, reply) => {
    const { user, session } = await auth.require(req, reply);
    if (user.role !== 'admin') throw forbidden();
    const body = parseInput(adminChangePasswordBodySchema, req.body);
    const now = clock.now();
    const limit = await consume(
      db,
      { key: `pwchange:user15m:${user.id}`, windowSec: 900, limit: 5 },
      now,
    );
    if (!limit.allowed) throw tooManyRequests(limit.retryAfterSec);

    const [cred] = await db
      .select()
      .from(adminCredentials)
      .where(eq(adminCredentials.userId, user.id));
    if (!cred) {
      throw new AppError(409, 'NO_PASSWORD', 'This account has no password yet.');
    }
    if (!(await verifyPassword(body.currentPassword, cred.passwordHash))) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid.', {
        fields: { currentPassword: 'That is not your current password.' },
      });
    }

    const passwordHash = await hashPassword(body.newPassword);
    await db.transaction(async (tx) => {
      await tx
        .update(adminCredentials)
        .set({ passwordHash, passwordChangedAt: now })
        .where(eq(adminCredentials.userId, user.id));
      await tx
        .update(sessionsTable)
        .set({ revokedAt: now, revokeReason: 'password_changed' })
        .where(
          and(
            eq(sessionsTable.userId, user.id),
            ne(sessionsTable.id, session.id),
            isNull(sessionsTable.revokedAt),
          ),
        );
      await audit(tx, user.id, 'admin.password_changed', { type: 'user', id: user.id });
    });
    return reply.status(204).send();
  });

  // Session restore on app start. Never sends an SMS.
  app.get('/auth/me', async (req, reply): Promise<CurrentUser> => {
    const { user } = await auth.require(req, reply);
    reply.header('Cache-Control', 'no-store');
    return toCurrentUser(user);
  });

  app.patch('/auth/me', async (req, reply): Promise<CurrentUser> => {
    const { user } = await auth.require(req, reply);
    const body = parseInput(updateProfileBodySchema, req.body);
    const [updated] = await db
      .update(users)
      .set({ ...body, updatedAt: clock.now() })
      .where(eq(users.id, user.id))
      .returning();
    return toCurrentUser(updated!);
  });

  app.post('/auth/logout', async (req, reply) => {
    const current = await auth.optional(req, reply);
    if (current) {
      await sessions.revoke(current.session.id, 'logout');
      onSessionRevoked?.(current.session.id);
    }
    clearSessionCookie(reply, config);
    return reply.status(204).send();
  });
}
