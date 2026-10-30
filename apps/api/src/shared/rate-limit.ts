import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { authLockouts, rateLimitBuckets } from '../db/schema.ts';
import type { Tx } from '../db/client.ts';

export interface LimitRule {
  key: string;
  windowSec: number;
  limit: number;
}

export interface LimitResult {
  allowed: boolean;
  count: number;
  retryAfterSec: number;
}

/**
 * Fixed-window counter in Postgres. The increment is a single atomic upsert, so concurrent
 * requests can never both see the same count. Works across API instances without Redis.
 */
export async function consume(db: Tx, rule: LimitRule, now: Date): Promise<LimitResult> {
  const windowMs = rule.windowSec * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await db
    .insert(rateLimitBuckets)
    .values({ key: rule.key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitBuckets.key, rateLimitBuckets.windowStart],
      set: { count: sql`${rateLimitBuckets.count} + 1` },
    })
    .returning({ count: rateLimitBuckets.count });

  const count = row!.count;
  const retryAfterSec = Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000);
  return { allowed: count <= rule.limit, count, retryAfterSec };
}

/** Consumes every rule; returns the first that is exceeded (all counters still advance). */
export async function consumeAll(
  db: Tx,
  rules: LimitRule[],
  now: Date,
): Promise<LimitResult | null> {
  let blocked: LimitResult | null = null;
  for (const rule of rules) {
    const r = await consume(db, rule, now);
    if (!r.allowed && (!blocked || r.retryAfterSec > blocked.retryAfterSec)) blocked = r;
  }
  return blocked;
}

export async function activeLockout(
  db: Tx,
  scope: 'phone' | 'ip',
  subject: string,
  now: Date,
): Promise<Date | null> {
  const rows = await db
    .select({ lockedUntil: authLockouts.lockedUntil })
    .from(authLockouts)
    .where(
      and(
        eq(authLockouts.scope, scope),
        eq(authLockouts.subject, subject),
        gt(authLockouts.lockedUntil, now),
      ),
    )
    .orderBy(desc(authLockouts.lockedUntil))
    .limit(1);
  return rows[0]?.lockedUntil ?? null;
}

export async function lockOut(
  db: Tx,
  scope: 'phone' | 'ip',
  subject: string,
  until: Date,
  reason: string,
): Promise<void> {
  await db.insert(authLockouts).values({ scope, subject, lockedUntil: until, reason });
}
