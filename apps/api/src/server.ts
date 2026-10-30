import { loadConfig, loadDotEnv } from './config/env.ts';
import { createDatabase } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';
import { buildApp } from './app.ts';

loadDotEnv();
const config = loadConfig();
// `--local-db` ignores DATABASE_URL and uses the embedded database, so unreleased migrations and
// test data never touch Neon.
const localDb = process.argv.includes('--local-db') && config.NODE_ENV !== 'production';
const database = createDatabase({
  url: localDb ? undefined : config.DATABASE_URL,
  pgliteDir: config.PGLITE_DIR,
});

// Convenience for local development only: the embedded database migrates itself on boot.
// A remote database is never migrated implicitly — use `npm run db:migrate`.
if (database.driver === 'pglite' && config.NODE_ENV !== 'production') {
  await runMigrations(database);
}

const app = await buildApp({ config, database });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await database.close();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.HOST, port: config.API_PORT });
app.log.info(`database: ${database.driver}`);
