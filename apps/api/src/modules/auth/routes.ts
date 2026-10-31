import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  otpRequestBodySchema,
  otpVerifyBodySchema,
  updateProfileBodySchema,
  type CurrentUser,
  type OtpChallenge,
  type OtpVerifyResponse,
} from '@dp/shared';
import type { Config } from '../../config/env.ts';
import type { Db } from '../../db/client.ts';
import { users } from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import { parseInput } from '../../shared/errors.ts';
import { clearSessionCookie, setSessionCookie, toCurrentUser, type Authenticator } from './http.ts';
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
