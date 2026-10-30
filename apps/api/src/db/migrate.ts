import { fileURLToPath } from 'node:url';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { Database, Schema } from './client.ts';

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

export async function runMigrations(database: Database): Promise<void> {
  const config = { migrationsFolder: MIGRATIONS_DIR };
  if (database.driver === 'pglite') {
    await migratePglite(database.db as PgliteDatabase<Schema>, config);
  } else {
    await migratePg(database.db as NodePgDatabase<Schema>, config);
  }
}
