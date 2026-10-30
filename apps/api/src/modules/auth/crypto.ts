import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Uniformly random 6-digit code from the OS CSPRNG. */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Keyed hash bound to the challenge id, so a hash cannot be replayed against another challenge. */
export function hashOtpCode(secret: string, challengeId: string, code: string): string {
  return createHmac('sha256', secret).update(`${challengeId}:${code}`).digest('base64url');
}

export function verifyOtpCode(
  secret: string,
  challengeId: string,
  code: string,
  expected: string,
): boolean {
  const actual = Buffer.from(hashOtpCode(secret, challengeId, code));
  const want = Buffer.from(expected);
  return actual.length === want.length && timingSafeEqual(actual, want);
}

/** 256-bit opaque session token for the cookie. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this hash is stored; a database leak does not reveal usable tokens. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
