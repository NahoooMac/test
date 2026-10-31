import { loadConfig, loadDotEnv } from './config/env.ts';
import { createDatabase } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';
import { buildApp } from './app.ts';
import { serveWebApp } from './web-static.ts';

loadDotEnv();
// Local production preview serves the web app from the API itself, so the browser's origin is the
// API's address. A real deployment sets APP_ORIGIN to the public https URL.
if (process.argv.includes('--serve-web') && !process.env.APP_ORIGIN) {
  process.env.APP_ORIGIN = `http://localhost:${process.env.API_PORT ?? 3000}`;
}
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

const { app, dispatcher } = await buildApp({ config, database });

// `--serve-web` serves ../web/dist (production preview); WEB_DIST_DIR sets the folder explicitly.
const webDir =
  config.WEB_DIST_DIR ?? (process.argv.includes('--serve-web') ? '../web/dist' : undefined);
if (webDir) {
  await serveWebApp(app, webDir);
  app.log.info(`serving web app from ${webDir}`);
}

// Dispatch loop: lapse expired offers and re-offer waiting deliveries. Safe to run on several
// instances at once because the database enforces one open offer per delivery and per rider.
const DISPATCH_INTERVAL_MS = 3000;
const dispatchTimer = setInterval(() => {
  dispatcher.tick().catch((err) => app.log.error({ err }, 'dispatch tick failed'));
}, DISPATCH_INTERVAL_MS);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  clearInterval(dispatchTimer);
  await app.close();
  await database.close();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.HOST, port: config.API_PORT });
app.log.info(`database: ${database.driver}`);
