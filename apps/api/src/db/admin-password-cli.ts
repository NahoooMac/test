// `npm run admin:password -- 0911234567 alice` — makes that account an admin (creating it if
// needed) and sets its username/password for the admin sign-in. Asks for the password; for
// scripts, ADMIN_PASSWORD can supply it. Remote databases need ALLOW_REMOTE_ADMIN_GRANT=true.
import { createInterface } from 'node:readline';
import { eq } from 'drizzle-orm';
import {
  ADMIN_PASSWORD_MIN,
  ADMIN_USERNAME_RE,
  maskPhone,
  normalizeEthiopianPhone,
} from '@dp/shared';
import { loadConfig, loadDotEnv } from '../config/env.ts';
import { hashPassword } from '../modules/auth/crypto.ts';
import { createDatabase } from './client.ts';
import { runMigrations } from './migrate.ts';
import { adminCredentials, sessions, users } from './schema.ts';

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/** Reads a line without echoing it. */
function askHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let prompted = false;
  out._writeToOutput = (s) => {
    if (!prompted) {
      out.output.write(s);
      prompted = true;
    }
  };
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    }),
  );
}

loadDotEnv();
const config = loadConfig();
// `--local-db`: the embedded database that `npm run dev:local` uses, even when .env names Neon.
const localDb = process.argv.includes('--local-db');
const args = process.argv.slice(2).filter((a) => a !== '--local-db');
const dbUrl = localDb ? undefined : config.DATABASE_URL;
const phone = normalizeEthiopianPhone(args[0] ?? '');
const username = (args[1] ?? '').trim().toLowerCase();
if (!phone.ok || !username) {
  fail('Usage: npm run admin:password -- <Ethiopian mobile number> <username>');
}
if (!ADMIN_USERNAME_RE.test(username)) {
  fail('Username: 3–32 characters, lowercase letters, digits, dot, dash or underscore.');
}
if (dbUrl && process.env.ALLOW_REMOTE_ADMIN_GRANT !== 'true') {
  fail('Refusing to change a remote database. Re-run with ALLOW_REMOTE_ADMIN_GRANT=true.');
}

let password = process.env.ADMIN_PASSWORD ?? '';
if (!password) {
  password = await askHidden('New password: ');
  if ((await askHidden('Repeat password: ')) !== password) fail('Passwords do not match.');
}
if (password.length < ADMIN_PASSWORD_MIN) {
  fail(`Password must be at least ${ADMIN_PASSWORD_MIN} characters.`);
}

const database = createDatabase({ url: dbUrl, pgliteDir: config.PGLITE_DIR });
try {
  if (database.driver === 'pglite') await runMigrations(database);
  const passwordHash = await hashPassword(password);
  const now = new Date();
  const user = await database.db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ phoneE164: phone.e164, role: 'admin' })
      .onConflictDoUpdate({ target: users.phoneE164, set: { role: 'admin', updatedAt: now } })
      .returning();
    const [taken] = await tx
      .select({ userId: adminCredentials.userId })
      .from(adminCredentials)
      .where(eq(adminCredentials.username, username));
    if (taken && taken.userId !== u!.id) fail(`Username "${username}" belongs to another admin.`);
    await tx
      .insert(adminCredentials)
      .values({ userId: u!.id, username, passwordHash, passwordChangedAt: now })
      .onConflictDoUpdate({
        target: adminCredentials.userId,
        set: { username, passwordHash, passwordChangedAt: now },
      });
    // A new password signs every existing session out.
    await tx
      .update(sessions)
      .set({ revokedAt: now, revokeReason: 'password_changed' })
      .where(eq(sessions.userId, u!.id));
    return u!;
  });
  console.log(
    `Admin ${maskPhone(user.phoneE164)} can now sign in at /admin as "${username}".`,
  );
} finally {
  await database.close();
}
