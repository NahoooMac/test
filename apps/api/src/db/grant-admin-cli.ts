// `npm run admin:grant -- 0911234567` — gives an account the admin role (creating it if needed).
// Admin is never self-service. Remote databases need ALLOW_REMOTE_ADMIN_GRANT=true for the run.
import { normalizeEthiopianPhone, maskPhone } from '@dp/shared';
import { loadConfig, loadDotEnv } from '../config/env.ts';
import { createDatabase } from './client.ts';
import { runMigrations } from './migrate.ts';
import { sessions, users } from './schema.ts';
import { eq } from 'drizzle-orm';

loadDotEnv();
const config = loadConfig();
const input = process.argv[2] ?? '';
const phone = normalizeEthiopianPhone(input);
if (!phone.ok) {
  console.error('Usage: npm run admin:grant -- <Ethiopian mobile number>');
  process.exit(1);
}
if (config.DATABASE_URL && process.env.ALLOW_REMOTE_ADMIN_GRANT !== 'true') {
  console.error('Refusing to change a remote database. Re-run with ALLOW_REMOTE_ADMIN_GRANT=true.');
  process.exit(1);
}

const database = createDatabase({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR });
try {
  if (database.driver === 'pglite') await runMigrations(database);
  const [user] = await database.db
    .insert(users)
    .values({ phoneE164: phone.e164, role: 'admin' })
    .onConflictDoUpdate({ target: users.phoneE164, set: { role: 'admin', updatedAt: new Date() } })
    .returning();
  // Existing sessions were issued under the old role's lifetime; make them sign in again.
  await database.db
    .update(sessions)
    .set({ revokedAt: new Date(), revokeReason: 'role_changed' })
    .where(eq(sessions.userId, user!.id));
  console.log(`Admin role granted to ${maskPhone(phone.e164)}. They sign in at /admin with OTP.`);
} finally {
  await database.close();
}
