# Phase 2 report — Foundation

Date: 2026-10-30

## Built

- **Repository**: new standalone Git repo, npm workspaces monorepo (`apps/api`, `apps/web`, `packages/shared`).
- **Shared package**: domain enums (roles, vehicle types, payers, payment methods, delivery statuses,
  active-rider statuses), the 11 Addis sub-cities (EN/AM), Ethiopian mobile normalization to E.164,
  santim-based money helpers, API error/health/current-user schemas.
- **API** (Fastify 5): validated env config that refuses unsafe production settings and never prints
  secret values; security headers; one error shape for every failure; `/api/health` and
  `/api/health/ready`; placeholder `/api/auth/me` (401) and `/api/auth/otp/request` (503) for Phase 3.
- **Database**: Drizzle schema + two migrations — `0000_init` (users, sessions, otp_challenges,
  sms_messages, rate_limit_buckets, auth_lockouts, service_areas) and `0001_seed_service_areas`.
  The database itself enforces: unique normalized phone, E.164 format check, one open OTP challenge
  per phone, consistent OTP close state, session expiry order.
- **Local database**: PGlite (embedded Postgres) — no Docker or Postgres install needed. Migrates
  itself on dev start. `npm run db:migrate` refuses remote databases unless explicitly allowed.
- **Web**: design tokens (light/dark, green/amber accent under evaluation), Inter + Noto Sans
  Ethiopic, 14 UI components, EN/AM i18n, same-origin API client, session bootstrap and role guards,
  three lazy-loaded surfaces (customer `/`, rider `/rider`, admin `/admin`) with phone sign-in screens,
  dev-only `/design` catalogue with example booking, tracking and rider screens.

## Checks

| Check                                                            | Result                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` (3 packages)                                 | pass                                                                                                                |
| `npm run lint`                                                   | pass                                                                                                                |
| `npm test` — shared 28, api 13                                   | 41 pass                                                                                                             |
| `npm run build`                                                  | pass — core bundle 140 kB gzip; each surface 1–2 kB                                                                 |
| Prettier                                                         | clean                                                                                                               |
| Browser (375 px mobile + 1280 px desktop, light + dark, EN + AM) | sign-in redirect, phone validation, API error display, language switch, admin layout, design catalogue all verified |

Fixed during verification: API port collided with the web dev server (`PORT` → `API_PORT`);
bottom sheet ignored absolute positioning; stepper labels truncated on narrow phones; rider icon tile
in dark mode.

## Deviations from the plan

- **npm workspaces instead of pnpm** — pnpm isn't installed; npm needs nothing extra.
- **PGlite instead of Docker Postgres** for local dev/tests — Docker isn't installed. Real
  multi-connection concurrency (Phase 4 rider assignment race) must be tested against a Neon dev branch,
  because PGlite is single-connection.
- Pinned to the previous stable majors of Vite (7) and React Router (7) rather than the newest.

## Not done / known gaps

- Neon not inspected — no credentials yet.
- Amharic copy is a draft; needs native-speaker review.
- ESLint 9 reports as end-of-life; upgrade to 10 in Phase 5.
- npm skipped esbuild's install scripts (new npm 11 policy); the Windows binary works without them.
- Core bundle could be trimmed (zod in the client) for low-end phones — Phase 5.
- The API runs through `tsx` in production for now; a compiled build is a Phase 5 task.

## Needed for Phase 3

- Decision on accent colour: **green** or **amber** (compare at `/design`).
- AfroMessage API token, sender name, and a test phone number — or approval to build Phase 3 with the
  console SMS provider first and plug AfroMessage in when credentials arrive.
- Optional now, required by Phase 4: Neon dev-branch connection strings (pooled + direct).
- Answers to plan questions Q1–Q11 (fare formula, dispatch model, `returning` status, etc.).
