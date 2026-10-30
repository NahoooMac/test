import { mkdirSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import * as schema from './schema.ts';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema> | PgliteDatabase<Schema>;

export interface Database {
  db: Db;
  driver: 'pg' | 'pglite';
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  /** Postgres connection string (Neon). When absent, an embedded PGlite database is used. */
  url?: string | undefined;
  /** PGlite data directory; `memory://` for an in-memory database (tests). */
  pgliteDir?: string;
}

export function createDatabase(opts: DatabaseOptions): Database {
  if (opts.url) {
    const pool = new pg.Pool({
      connectionString: opts.url,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    const db = drizzlePg(pool, { schema });
    return {
      db,
      driver: 'pg',
      ping: () => ping(db),
      close: () => pool.end(),
    };
  }

  const dir = opts.pgliteDir ?? 'memory://';
  if (!dir.startsWith('memory://')) mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzlePglite(client, { schema });
  return {
    db,
    driver: 'pglite',
    ping: () => ping(db),
    close: () => client.close(),
  };
}

async function ping(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
