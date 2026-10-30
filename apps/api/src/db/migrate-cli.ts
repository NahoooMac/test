// `npm run db:migrate` — applies pending migrations.
// Local PGlite: always allowed. Remote Postgres (Neon): refused unless ALLOW_REMOTE_MIGRATIONS=true.
import { loadConfig, loadDotEnv } from '../config/env.ts';
import { createDatabase } from './client.ts';
import { runMigrations } from './migrate.ts';

loadDotEnv();
const config = loadConfig();
const url = config.DATABASE_URL_DIRECT ?? config.DATABASE_URL;

if (url && !config.ALLOW_REMOTE_MIGRATIONS) {
  console.error(
    'Refusing to migrate a remote database. Review the SQL in src/db/migrations, confirm the target is a ' +
      'development branch, then re-run with ALLOW_REMOTE_MIGRATIONS=true for this single run.',
  );
  process.exit(1);
}

const database = createDatabase({ url, pgliteDir: config.PGLITE_DIR });
const target = url ? `remote Postgres (${new URL(url).hostname})` : `local PGlite (${config.PGLITE_DIR})`;
console.log(`Applying migrations to ${target}…`);

try {
  await runMigrations(database);
  console.log('Migrations applied.');
} finally {
  await database.close();
}
