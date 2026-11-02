/* global console, process */
// Dev helper: clears sign-in lockouts, rate-limit counters and open OTP challenges.
// Reads the database address from apps/api/.env — never put connection strings in this file.
//   node --env-file=.env clear-lockouts.mjs
import pg from 'pg';
const { Client } = pg;

const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Run: node --env-file=.env clear-lockouts.mjs');
  process.exit(1);
}

const client = new Client({ connectionString });
await client.connect();

const r1 = await client.query('DELETE FROM auth_lockouts');
console.log('auth_lockouts deleted:', r1.rowCount);

const r2 = await client.query('DELETE FROM rate_limit_buckets');
console.log('rate_limit_buckets deleted:', r2.rowCount);

const r3 = await client.query(
  "UPDATE otp_challenges SET closed_at = now(), close_reason = 'expired' WHERE closed_at IS NULL",
);
console.log('otp_challenges closed:', r3.rowCount);

await client.end();
console.log('Done!');
