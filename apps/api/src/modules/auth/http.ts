import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CurrentUser, Language, UserRole } from '@dp/shared';
import type { Config } from '../../config/env.ts';
import { AppError, forbidden, unauthenticated } from '../../shared/errors.ts';
import type { ResolvedSession, SessionService, UserRow } from './sessions.ts';

export function sessionCookieName(config: Config): string {
  // __Host- prefix: browser enforces Secure, Path=/ and no Domain (no subdomain can set it).
  return config.NODE_ENV === 'production' ? '__Host-sid' : 'sid';
}

export function setSessionCookie(
  reply: FastifyReply,
  config: Config,
  token: string,
  expiresAt: Date,
) {
  reply.setCookie(sessionCookieName(config), token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: Config) {
  reply.clearCookie(sessionCookieName(config), { path: '/' });
}

export function toCurrentUser(u: UserRow): CurrentUser {
  return {
    id: u.id,
    phone: u.phoneE164,
    fullName: u.fullName,
    role: u.role,
    status: u.status,
    preferredLanguage: u.preferredLanguage as Language,
  };
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence in depth on top of SameSite=Lax: state-changing requests must come from our own
 * origin when the browser tells us where they came from, and must be JSON when they carry a body.
 */
export function registerCsrfGuard(app: FastifyInstance, config: Config) {
  const allowed = new URL(config.APP_ORIGIN).origin;
  // Development only: also accept the address the page was actually opened on (a phone on the
  // LAN reaches the Vite proxy at the PC's IP, which the proxy passes through as Host).
  const sameHost = (origin: string, host: string | undefined) =>
    config.NODE_ENV !== 'production' && !!host && URL.parse(origin)?.host === host;
  app.addHook('onRequest', async (req) => {
    if (!UNSAFE.has(req.method)) return;
    const origin = req.headers.origin;
    const fetchSite = req.headers['sec-fetch-site'];
    if (origin && origin !== allowed && !sameHost(origin, req.headers.host)) throw forbidden();
    if (!origin && fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none')
      throw forbidden();

    const length = Number(req.headers['content-length'] ?? 0);
    const type = req.headers['content-type'] ?? '';
    if (length > 0 && !type.startsWith('application/json')) {
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON.');
    }
  });
}

/** Per-request session resolution, memoized so several guards on one request query once. */
export function createAuthenticator(sessions: SessionService, config: Config) {
  const cache = new WeakMap<FastifyRequest, Promise<ResolvedSession | null>>();

  async function resolve(req: FastifyRequest, reply: FastifyReply) {
    let pending = cache.get(req);
    if (!pending) {
      pending = sessions.resolve(req.cookies[sessionCookieName(config)]).then((r) => {
        if (r?.refreshedExpiresAt) {
          setSessionCookie(
            reply,
            config,
            req.cookies[sessionCookieName(config)]!,
            r.refreshedExpiresAt,
          );
        }
        return r;
      });
      cache.set(req, pending);
    }
    return pending;
  }

  return {
    /** Session if signed in, otherwise null. */
    optional: resolve,

    /** Throws 401 when signed out, 403 when the role does not match. */
    async require(
      req: FastifyRequest,
      reply: FastifyReply,
      role?: UserRole,
    ): Promise<ResolvedSession> {
      const auth = await resolve(req, reply);
      if (!auth) {
        // Drop a stale cookie so the browser stops sending it.
        if (req.cookies[sessionCookieName(config)]) clearSessionCookie(reply, config);
        throw unauthenticated();
      }
      // Riders may also send parcels: 'customer' admits riders, so one phone signs in to both apps.
      const ok =
        !role ||
        auth.user.role === role ||
        (role === 'customer' && auth.user.role === 'rider');
      if (!ok) throw forbidden();
      return auth;
    },
  };
}

export type Authenticator = ReturnType<typeof createAuthenticator>;
