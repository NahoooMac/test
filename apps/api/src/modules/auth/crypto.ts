import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keyLen: 64 };

function scryptAsync(password: string, salt: Buffer, keyLen: number, opts: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, keyLen, { ...opts, maxmem: 128 * opts.N! * opts.r! * 2 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/** scrypt with a random salt, encoded with its parameters so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keyLen } = SCRYPT;
  const key = await scryptAsync(password, salt, keyLen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64url'), want.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(key, want);
}

/** Verified against when the username is unknown, so response time does not reveal it. */
export const DUMMY_PASSWORD_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$' + 'A'.repeat(86);

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
