import { loadConfig } from '../src/config/env.ts';
import { createDatabase, type Database } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { buildApp } from '../src/app.ts';

/** Fresh in-memory Postgres (PGlite) with all migrations applied. Never touches Neon. */
export async function createTestDatabase(): Promise<Database> {
  const database = createDatabase({ pgliteDir: 'memory://' });
  await runMigrations(database);
  return database;
}

export async function createTestApp() {
  const database = await createTestDatabase();
  const config = loadConfig({ NODE_ENV: 'test' });
  const app = await buildApp({ config, database });
  return {
    app,
    database,
    async close() {
      await app.close();
      await database.close();
    },
  };
}
