import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { maskPhone, normalizeEthiopianPhone, type OtpChallenge } from '@dp/shared';
import type { Config } from '../../config/env.ts';
import type { Db } from '../../db/client.ts';
import { adminCredentials, otpChallenges, smsMessages, users } from '../../db/schema.ts';
import { SmsSendError, type SmsProvider } from '../../integrations/sms/index.ts';
import { addSeconds, type Clock } from '../../shared/clock.ts';
import { AppError, isUniqueViolation, tooManyRequests } from '../../shared/errors.ts';
import { activeLockout, consume, consumeAll, lockOut } from '../../shared/rate-limit.ts';
import { DEMO_OTP, isDemoPhone } from '../../demo/accounts.ts';
import { generateOtpCode, hashOtpCode, verifyOtpCode } from './crypto.ts';
import type { SessionService, UserRow } from './sessions.ts';

type ChallengeRow = typeof otpChallenges.$inferSelect;

export interface OtpDeps {
  db: Db;
  config: Config;
  clock: Clock;
  sms: SmsProvider;
  sessions: SessionService;
  log: FastifyBaseLogger;
}

export interface RequestContext {
  ip: string;
  userAgent: string | undefined;
}

const invalidCode = (details?: Record<string, unknown>) =>
  new AppError(400, 'INVALID_CODE', 'That code is not correct or has expired.', { details });

const lockedOut = (until: Date, now: Date) =>
  new AppError(429, 'AUTH_LOCKED', 'Too many incorrect codes. Please wait before trying again.', {
    details: { retryAfterSec: Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000)) },
  });

/**
 * Phone OTP sign-in. Cost and abuse rules:
 *  - an open, unexpired challenge is reused; inside the resend cooldown no SMS is sent at all
 *  - per-phone, per-IP and a global daily budget limit actual sends
 *  - wrong codes are counted atomically; exhausting attempts closes the challenge and locks the phone
 *  - an SMS that may have been delivered (timeout) is never retried automatically
 *  - codes are stored only as a keyed hash and never logged
 */
export class OtpService {
  private readonly d: OtpDeps;

  constructor(deps: OtpDeps) {
    this.d = deps;
  }

  async request(phoneInput: string, ctx: RequestContext, attempt = 0): Promise<OtpChallenge> {
    const { db, config, clock } = this.d;
    const now = clock.now();

    const normalized = normalizeEthiopianPhone(phoneInput);
    if (!normalized.ok) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Some fields are invalid.', {
        fields: { phone: 'Enter a valid Ethiopian mobile number.' },
      });
    }
    const phone = normalized.e164;

    const lockedUntil =
      (await activeLockout(db, 'phone', phone, now)) ??
      (await activeLockout(db, 'ip', ctx.ip, now));
    if (lockedUntil) throw lockedOut(lockedUntil, now);

    let challenge = await this.findOpen(phone);
    if (challenge && challenge.expiresAt <= now) {
      await this.close(challenge.id, 'expired');
      challenge = null;
    }

    // Reuse: still inside the cooldown → answer with the existing challenge and send nothing.
    if (challenge && challenge.lastSentAt && this.cooldownLeft(challenge, now) > 0) {
      return this.describe(challenge, now);
    }

    const demoBypass = config.DEMO_MODE && isDemoPhone(phone);

    // We are about to spend an SMS: apply limits (demo accounts skip this).
    if (!demoBypass) {
      const blocked = await consumeAll(
        db,
        [
          { key: `otp:phone15m:${phone}`, windowSec: 900, limit: config.OTP_PHONE_SENDS_PER_15MIN },
          { key: `otp:phone1d:${phone}`, windowSec: 86_400, limit: config.OTP_PHONE_SENDS_PER_DAY },
          { key: `otp:ip1h:${ctx.ip}`, windowSec: 3600, limit: config.OTP_IP_SENDS_PER_HOUR },
        ],
        now,
      );
      if (blocked) throw tooManyRequests(blocked.retryAfterSec);

      const budget = await consume(
        db,
        { key: 'otp:global1d', windowSec: 86_400, limit: config.SMS_DAILY_BUDGET },
        now,
      );
      if (!budget.allowed) {
        this.d.log.warn({ count: budget.count }, 'daily SMS budget exhausted; OTP not sent');
        throw new AppError(
          503,
          'SMS_UNAVAILABLE',
          "We can't send codes right now. Please try again later.",
          {
            details: { retryAfterSec: budget.retryAfterSec },
          },
        );
      }
    }

    const code = demoBypass ? DEMO_OTP[phone]! : generateOtpCode();
    const expiresAt = addSeconds(now, config.OTP_TTL_SEC);

    if (challenge) {
      // Claim the resend atomically: only one concurrent request can pass the cooldown check.
      const cooldownStart = addSeconds(now, -config.OTP_RESEND_COOLDOWN_SEC);
      const [claimed] = await db
        .update(otpChallenges)
        .set({
          codeHash: hashOtpCode(config.OTP_HMAC_SECRET, challenge.id, code),
          sendCount: sql`${otpChallenges.sendCount} + 1`,
          attempts: 0,
          lastSentAt: now,
          expiresAt,
        })
        .where(
          and(
            eq(otpChallenges.id, challenge.id),
            isNull(otpChallenges.closedAt),
            or(isNull(otpChallenges.lastSentAt), lt(otpChallenges.lastSentAt, cooldownStart)),
          ),
        )
        .returning();
      if (!claimed) return this.retryOnce(phoneInput, ctx, attempt);
      challenge = claimed;
    } else {
      const id = randomUUID();
      try {
        const [created] = await db
          .insert(otpChallenges)
          .values({
            id,
            phoneE164: phone,
            codeHash: hashOtpCode(config.OTP_HMAC_SECRET, id, code),
            expiresAt,
            maxAttempts: config.OTP_MAX_ATTEMPTS,
            sendCount: 1,
            lastSentAt: now,
            requestIp: ctx.ip,
            createdAt: now,
          })
          .returning();
        challenge = created!;
      } catch (err) {
        // A concurrent request opened a challenge first; reuse it rather than sending twice.
        if (isUniqueViolation(err)) return this.retryOnce(phoneInput, ctx, attempt);
        throw err;
      }
    }

    if (!demoBypass) await this.sendCode(challenge, code);
    const described = this.describe(challenge, now);
    // Development with the console provider (no real SMS): hand the code to the screen so phones
    // on the LAN can sign in. Config refuses the console provider in production.
    if (this.d.sms.name === 'console' && config.NODE_ENV === 'development') {
      return { ...described, devCode: code };
    }
    return described;
  }

  async verify(
    challengeId: string,
    code: string,
    ctx: RequestContext,
  ): Promise<{ user: UserRow; token: string; expiresAt: Date }> {
    const challenge = await this.check(challengeId, code, ctx);
    return this.signIn(challenge, ctx);
  }

  /**
   * Proves the code for a challenge without signing anyone in (admin recovery phone, 2-step,
   * password reset). Same attempt counting and lockout as sign-in; the challenge is used up.
   */
  async confirm(challengeId: string, code: string, ctx: RequestContext): Promise<string> {
    const challenge = await this.check(challengeId, code, ctx);
    const [consumed] = await this.d.db
      .update(otpChallenges)
      .set({ closedAt: this.d.clock.now(), closeReason: 'consumed' })
      .where(and(eq(otpChallenges.id, challenge.id), isNull(otpChallenges.closedAt)))
      .returning({ id: otpChallenges.id });
    if (!consumed) throw invalidCode({ expired: true });
    return challenge.phoneE164;
  }

  /** Counts the attempt and compares the code; throws on a wrong, expired or exhausted code. */
  private async check(
    challengeId: string,
    code: string,
    ctx: RequestContext,
  ): Promise<ChallengeRow> {
    const { db, config, clock } = this.d;
    const now = clock.now();

    const ipLimit = await consume(
      db,
      { key: `otp:verify15m:${ctx.ip}`, windowSec: 900, limit: config.OTP_IP_VERIFIES_PER_15MIN },
      now,
    );
    if (!ipLimit.allowed) throw tooManyRequests(ipLimit.retryAfterSec);

    // Count the attempt before comparing, atomically, so parallel guesses cannot exceed the limit.
    const [challenge] = await db
      .update(otpChallenges)
      .set({ attempts: sql`${otpChallenges.attempts} + 1` })
      .where(
        and(
          eq(otpChallenges.id, challengeId),
          isNull(otpChallenges.closedAt),
          gt(otpChallenges.expiresAt, now),
          lt(otpChallenges.attempts, otpChallenges.maxAttempts),
        ),
      )
      .returning();

    if (!challenge) throw invalidCode({ expired: true });

    if (!verifyOtpCode(config.OTP_HMAC_SECRET, challenge.id, code, challenge.codeHash)) {
      const remaining = challenge.maxAttempts - challenge.attempts;
      if (remaining <= 0) {
        await this.close(challenge.id, 'max_attempts');
        const until = new Date(now.getTime() + config.OTP_LOCKOUT_MIN * 60_000);
        await lockOut(db, 'phone', challenge.phoneE164, until, 'otp_max_attempts');
        this.d.log.warn(
          { phone: maskPhone(challenge.phoneE164) },
          'OTP attempts exhausted; phone locked',
        );
        throw lockedOut(until, now);
      }
      throw invalidCode({ attemptsRemaining: remaining });
    }
    return challenge;
  }

  private async signIn(
    challenge: ChallengeRow,
    ctx: RequestContext,
  ): Promise<{ user: UserRow; token: string; expiresAt: Date }> {
    const { db } = this.d;
    const now = this.d.clock.now();
    return db.transaction(async (tx) => {
      // Single use: only the first successful verification closes the challenge.
      const [consumed] = await tx
        .update(otpChallenges)
        .set({ closedAt: now, closeReason: 'consumed' })
        .where(and(eq(otpChallenges.id, challenge.id), isNull(otpChallenges.closedAt)))
        .returning({ id: otpChallenges.id });
      if (!consumed) throw invalidCode({ expired: true });

      // One account per normalized phone, even under concurrent first sign-ins.
      const [user] = await tx
        .insert(users)
        .values({
          phoneE164: challenge.phoneE164,
          phoneVerifiedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: users.phoneE164,
          set: {
            phoneVerifiedAt: sql`coalesce(${users.phoneVerifiedAt}, ${now.toISOString()}::timestamptz)`,
            updatedAt: now,
          },
        })
        .returning();

      if (user!.status !== 'active') {
        throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support.');
      }
      // An admin with a password signs in only with it; a code to their phone is not enough.
      const [cred] = await tx
        .select({ userId: adminCredentials.userId })
        .from(adminCredentials)
        .where(eq(adminCredentials.userId, user!.id));
      if (cred) {
        throw new AppError(
          403,
          'USE_PASSWORD',
          'This is a staff account. Sign in with your username and password at /admin.',
        );
      }

      const session = await this.d.sessions.create(tx, user!, ctx);
      return { user: user!, ...session };
    });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async retryOnce(phoneInput: string, ctx: RequestContext, attempt: number) {
    if (attempt >= 1) {
      throw new AppError(409, 'TRY_AGAIN', 'Please try again.');
    }
    return this.request(phoneInput, ctx, attempt + 1);
  }

  private async findOpen(phone: string): Promise<ChallengeRow | null> {
    const [row] = await this.d.db
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.phoneE164, phone),
          eq(otpChallenges.purpose, 'login'),
          isNull(otpChallenges.closedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async close(id: string, reason: 'expired' | 'max_attempts' | 'superseded') {
    await this.d.db
      .update(otpChallenges)
      .set({ closedAt: this.d.clock.now(), closeReason: reason })
      .where(and(eq(otpChallenges.id, id), isNull(otpChallenges.closedAt)));
  }

  private cooldownLeft(c: ChallengeRow, now: Date): number {
    if (!c.lastSentAt) return 0;
    const until = c.lastSentAt.getTime() + this.d.config.OTP_RESEND_COOLDOWN_SEC * 1000;
    return Math.max(0, Math.ceil((until - now.getTime()) / 1000));
  }

  private describe(c: ChallengeRow, now: Date): OtpChallenge {
    return {
      challengeId: c.id,
      maskedPhone: maskPhone(c.phoneE164),
      expiresInSec: Math.max(0, Math.floor((c.expiresAt.getTime() - now.getTime()) / 1000)),
      resendAfterSec: this.cooldownLeft(c, now),
    };
  }

  private messageText(code: string): string {
    const minutes = Math.round(this.d.config.OTP_TTL_SEC / 60);
    const host = new URL(this.d.config.APP_ORIGIN).hostname;
    // Last line follows the WebOTP format so Android Chrome can offer to fill the code.
    return `${code} is your verification code. It expires in ${minutes} minutes. Do not share it.\n\n@${host} #${code}`;
  }

  private async sendCode(challenge: ChallengeRow, code: string): Promise<void> {
    const { db, sms, log } = this.d;
    const [record] = await db
      .insert(smsMessages)
      .values({
        provider: sms.name,
        phoneE164: challenge.phoneE164,
        purpose: 'login_otp',
        challengeId: challenge.id,
        status: 'queued',
      })
      .returning({ id: smsMessages.id });

    try {
      const result = await sms.send({ to: challenge.phoneE164, text: this.messageText(code) });
      await db
        .update(smsMessages)
        .set({
          status: result.status,
          providerMessageId: result.providerMessageId,
          updatedAt: this.d.clock.now(),
        })
        .where(eq(smsMessages.id, record!.id));
    } catch (err) {
      const e =
        err instanceof SmsSendError
          ? err
          : new SmsSendError('unknown', 'UNEXPECTED', 'Unexpected SMS error');
      await db
        .update(smsMessages)
        .set({
          status: 'failed',
          errorCode: e.code,
          errorMessage: e.message,
          updatedAt: this.d.clock.now(),
        })
        .where(eq(smsMessages.id, record!.id));
      // Never log the message text: it contains the code.
      log.warn(
        {
          smsId: record!.id,
          provider: sms.name,
          code: e.code,
          outcome: e.outcome,
          phone: maskPhone(challenge.phoneE164),
        },
        'OTP SMS failed',
      );

      if (e.outcome === 'not_sent') {
        // Definitely not delivered: let the user retry straight away.
        await db
          .update(otpChallenges)
          .set({ lastSentAt: null })
          .where(eq(otpChallenges.id, challenge.id));
        // Our side (balance used up, bad API key, provider down): not the user's number. Say so,
        // and log loudly so an operator tops up / fixes it.
        if (/^(AFRO_401|HTTP_401|HTTP_403|HTTP_5)/.test(e.code)) {
          log.error({ provider: sms.name, code: e.code, reason: e.message }, 'SMS provider unavailable');
          throw new AppError(
            503,
            'SMS_UNAVAILABLE',
            "We can't send codes right now. Please try again later.",
          );
        }
        throw new AppError(502, 'SMS_SEND_FAILED', "We couldn't send the code. Please try again.");
      }
      // Outcome unknown (e.g. timeout): the SMS may still arrive. Keep the cooldown so we don't
      // send a duplicate; the user can tap "resend" once it ends.
    }
  }
}
