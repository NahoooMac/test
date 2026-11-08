// `npm run photos:backfill` — gives KYC-approved riders who have no profile photo yet their approved
// front-face capture (for riders approved before profile photos existed). Safe to re-run.
// `--local-db` targets the embedded database; remote databases need ALLOW_REMOTE_PHOTO_BACKFILL=true.
import { maskPhone } from '@dp/shared';
import { inArray } from 'drizzle-orm';
import { loadConfig, loadDotEnv } from '../config/env.ts';
import { KycService } from '../modules/kyc/service.ts';
import { systemClock } from '../shared/clock.ts';
import { createDatabase } from './client.ts';
import { runMigrations } from './migrate.ts';
import { users } from './schema.ts';

loadDotEnv();
const config = loadConfig();
const localDb = process.argv.includes('--local-db');
const url = localDb ? undefined : config.DATABASE_URL;
if (url && process.env.ALLOW_REMOTE_PHOTO_BACKFILL !== 'true') {
  console.error('Refusing to change a remote database. Re-run with ALLOW_REMOTE_PHOTO_BACKFILL=true.');
  process.exit(1);
}

const database = createDatabase({ url, pgliteDir: config.PGLITE_DIR });
try {
  if (database.driver === 'pglite') await runMigrations(database);
  const kyc = new KycService(database.db, config, systemClock);
  const { filled, missingFace } = await kyc.backfillProfilePhotos();
  const phones = async (ids: string[]) =>
    ids.length
      ? (await database.db.select({ p: users.phoneE164 }).from(users).where(inArray(users.id, ids))).map((r) => maskPhone(r.p))
      : [];
  console.log(`Profile photos filled: ${filled.length}`, await phones(filled));
  if (missingFace.length) {
    console.log(`Approved but no front-face photo on file: ${missingFace.length}`, await phones(missingFace));
  }
} finally {
  await database.close();
}
