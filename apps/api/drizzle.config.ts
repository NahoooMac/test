import { defineConfig } from 'drizzle-kit';

// Only used to GENERATE migration SQL from the schema; it does not connect to a database.
// Applying migrations goes through `npm run db:migrate`, which has its own safety checks.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  strict: true,
  verbose: true,
});
