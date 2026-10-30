# Parcel delivery platform — Addis Ababa (working name)

Motorcycle and bicycle parcel delivery: customer booking, rider jobs, live tracking, admin operations.
The product name is not final; it is set in one place (`VITE_APP_NAME`, default "Courier").

See [docs/00-phase1-plan.md](docs/00-phase1-plan.md) for the architecture and roadmap.

## Layout

```
apps/api        Fastify + TypeScript API (modular monolith), Drizzle ORM, migrations
apps/web        React + Vite + Tailwind — customer (/), rider (/rider), admin (/admin)
packages/shared Types, enums, zod schemas, phone and money helpers used by both
docs/           Plans and decisions
```

## Requirements

- Node.js 22.12+ (developed on 24)
- No database install needed for local work: the API uses **PGlite** (real Postgres compiled to
  WebAssembly, stored in `apps/api/.data/pglite`) when `DATABASE_URL` is empty.

## Getting started

```bash
npm install
npm run dev
```

- Web: http://localhost:5173 (customer), `/rider`, `/admin`, and `/design` (design system, dev only)
- API: http://127.0.0.1:3000/api/health — the web dev server proxies `/api` so cookies stay same-origin.

Optional: copy `apps/api/.env.example` to `apps/api/.env` to change settings.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

API tests run against a fresh in-memory PGlite database with all migrations applied — they never
touch Neon.

## Database and migrations

- Schema: `apps/api/src/db/schema.ts`. Generate SQL after a schema change: `npm run db:generate`.
- Review the generated SQL in `apps/api/src/db/migrations/` before applying it anywhere.
- Local PGlite migrates itself when the API starts.
- `npm run db:migrate` refuses to touch a remote database unless `ALLOW_REMOTE_MIGRATIONS=true`
  is set for that run. Use a Neon **development branch**, never the main branch.

## Local vs Neon database

- `npm run dev` uses `DATABASE_URL` from `apps/api/.env`, which currently points at Neon.
- `npm run dev:local` ignores it and uses the embedded local database instead. Use this for trying
  unreleased migrations and for test data that shouldn't go to Neon.

## Signing in locally

Sign-in is by phone and a one-time code. In development, `SMS_PROVIDER=console` prints the code to
the terminal running `npm run dev` instead of sending an SMS, for example:

```
[dev sms → +251 9•• ••• •67] 123456 is your verification code…
```

To make an admin account, stop the dev server first (the local database is single-process), then run:

```bash
npm run admin:grant -- 0911234567
```

## Secrets

Never commit `.env`. Configuration errors print variable names, never values.
