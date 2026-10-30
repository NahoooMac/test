import { and, eq, isNull } from 'drizzle-orm';
import type { UserRole } from '@dp/shared';
import type { Config } from '../../config/env.ts';
import type { Db, Tx } from '../../db/client.ts';
import { sessions, users } from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import { generateSessionToken, hashSessionToken } from './crypto.ts';

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;

export interface ResolvedSession {
  session: SessionRow;
  user: UserRow;
  /** Set when the idle expiry was extended on this request, so the cookie should be re-issued. */
  refreshedExpiresAt: Date | null;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Sliding expiry is extended at most this often, to avoid a write on every request. */
const TOUCH_INTERVAL_MS = HOUR_MS;

export class SessionService {
  private readonly db: Db;
  private readonly config: Config;
  private readonly clock: Clock;

  constructor(db: Db, config: Config, clock: Clock) {
    this.db = db;
    this.config = config;
    this.clock = clock;
  }

  private policy(role: UserRole): { idleMs: number; absoluteMs: number } {
    if (role === 'admin') {
      const ms = this.config.ADMIN_SESSION_HOURS * HOUR_MS;
      return { idleMs: ms, absoluteMs: ms };
    }
    return {
      idleMs: this.config.SESSION_IDLE_DAYS * DAY_MS,
      absoluteMs: this.config.SESSION_ABSOLUTE_DAYS * DAY_MS,
    };
  }

  async create(
    tx: Tx,
    user: UserRow,
    meta: { ip: string; userAgent: string | undefined },
  ): Promise<{ token: string; expiresAt: Date }> {
    const now = this.clock.now();
    const { idleMs, absoluteMs } = this.policy(user.role);
    const token = generateSessionToken();
    const expiresAt = new Date(now.getTime() + idleMs);
    await tx.insert(sessions).values({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      absoluteExpiresAt: new Date(now.getTime() + absoluteMs),
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300),
    });
    return { token, expiresAt };
  }

  /** Looks up a cookie token. Returns null for unknown, expired, revoked, or suspended. */
  async resolve(token: string | undefined): Promise<ResolvedSession | null> {
    if (!token || token.length < 32 || token.length > 128) return null;
    const now = this.clock.now();

    const [row] = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, hashSessionToken(token)))
      .limit(1);

    if (!row) return null;
    const { session, user } = row;
    if (session.revokedAt || session.expiresAt <= now || session.absoluteExpiresAt <= now)
      return null;

    if (user.status !== 'active') {
      await this.revoke(session.id, 'user_suspended');
      return null;
    }

    let refreshedExpiresAt: Date | null = null;
    if (now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
      const { idleMs } = this.policy(user.role);
      const extended = new Date(
        Math.min(now.getTime() + idleMs, session.absoluteExpiresAt.getTime()),
      );
      await this.db
        .update(sessions)
        .set({ lastSeenAt: now, expiresAt: extended })
        .where(eq(sessions.id, session.id));
      session.lastSeenAt = now;
      session.expiresAt = extended;
      refreshedExpiresAt = extended;
    }

    return { session, user, refreshedExpiresAt };
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: this.clock.now(), revokeReason: reason })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: this.clock.now(), revokeReason: reason })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }
}
