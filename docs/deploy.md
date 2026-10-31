# Deployment

Production is **one Node process**. It serves the API under `/api` and the built web app from the
same origin, so the HttpOnly session cookie and the live event stream need no CORS.

```
Browser ──https──▶ reverse proxy / platform TLS ──http──▶ node (API + web app) ──TLS──▶ Neon Postgres
                                                         └──▶ AfroMessage (SMS), Yandex (places)
```

## Requirements

- Node.js **22.18+** (24 recommended). The API runs its TypeScript sources directly with Node's
  built-in type stripping, so there is no API build step.
- A Neon Postgres database. Use the **pooled** connection string for the app and the **direct**
  one for migrations.
- HTTPS in front of the app, from the platform or a reverse proxy.
- **One instance.** See [Scaling](#scaling) before running more than one.

## Build and start

```bash
npm ci
npm run build          # builds apps/web/dist (needs the VITE_* variables below at build time)
npm start              # node apps/api/src/server.ts
```

`npm ci --omit=dev` also works for the runtime. Run `npm run build` first (it needs Vite, a dev
dependency), or build in a separate stage and copy `apps/web/dist`.

On a container platform, set `HOST=0.0.0.0`. The default `127.0.0.1` accepts local connections
only.

Health checks:

- `GET /api/health` → `{"status":"ok", …}`: the process is up (liveness).
- `GET /api/health/ready` → 200 `{"status":"ready"}` only when the database answers, otherwise
  503 (readiness).

## Environment

API variables go in the platform's secret store, or `apps/api/.env` on a plain server. Start from
[apps/api/.env.example](../apps/api/.env.example). The server refuses to start in production
with a missing or unsafe value, and the error names the variable, never its value.

| Variable                                                                     | Production value                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                   | `production`. This turns on the `__Host-` Secure cookie, the https-only origin, proxy trust and production config checks.                                                                                         |
| `APP_ORIGIN`                                                                 | **Exactly** the public address people open, e.g. `https://app.example.et`: https, no path, no trailing slash. Every state-changing request is checked against it; a mismatch rejects all sign-ins with 403.       |
| `WEB_DIST_DIR`                                                               | Path to `apps/web/dist`, absolute or relative to `apps/api`, e.g. `../web/dist`. Without it the process serves the API only.                                                                                      |
| `HOST`, `API_PORT`                                                           | `0.0.0.0` in containers; the port the platform routes to (default 3000). The variable is `API_PORT`, not `PORT`.                                                                                                  |
| `TRUST_PROXY`                                                                | How many proxies sit in front: unset or `1` for one platform proxy, `2` for a CDN plus a proxy, or the proxies' IPs/CIDRs. `true` is refused because anyone could fake their IP and evade the per-IP code limits. |
| `DATABASE_URL`                                                               | Neon **pooled** connection string with `sslmode=verify-full`.                                                                                                                                                     |
| `DATABASE_URL_DIRECT`                                                        | Neon **direct** connection string, used only by `npm run db:migrate`.                                                                                                                                             |
| `OTP_HMAC_SECRET`                                                            | 32+ random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Changing it invalidates codes already sent, but not sessions.                                            |
| `SMS_PROVIDER`                                                               | `afromessage` (`console` is refused in production).                                                                                                                                                               |
| `AFROMESSAGE_TOKEN`, `AFROMESSAGE_IDENTIFIER_ID`, `AFROMESSAGE_SENDER`       | From the AfroMessage dashboard. **Not yet verified with a real send.** Do that before launch.                                                                                                                     |
| `SMS_DAILY_BUDGET`                                                           | Maximum sign-in SMS per UTC day across everyone (default 500). This is the cost cap.                                                                                                                              |
| `YANDEX_GEOCODER_KEY`, `YANDEX_GEOSUGGEST_KEY`                               | Server-side keys for place search and address lookup.                                                                                                                                                             |
| `LOG_LEVEL`                                                                  | `info`. Logs are JSON on stdout. Request logs contain method, path and IP, never cookies, headers or bodies.                                                                                                      |
| `SESSION_IDLE_DAYS`, `SESSION_ABSOLUTE_DAYS`, `ADMIN_SESSION_HOURS`, `OTP_*` | Defaults are reasonable (30 days idle, 90 absolute, 12 hours for admins).                                                                                                                                         |

Web build variables are set **at build time** and end up in public JavaScript, so never put a
secret there. Start from [apps/web/.env.example](../apps/web/.env.example):

| Variable             | Value                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `VITE_YANDEX_JS_KEY` | Yandex Maps JS API v2.1 key. In the Yandex console, restrict it to the production domain. |
| `VITE_APP_NAME`      | Product name shown in the apps. The brand isn't final; the default is "Courier".          |

## HTTPS and the proxy

- Terminate TLS at the platform or proxy and forward plain HTTP to the app. Helmet sends
  `Strict-Transport-Security`. Don't put the app on plain HTTP behind a public load balancer
  without TLS.
- Forward `X-Forwarded-For` and `X-Forwarded-Proto`, and set `TRUST_PROXY` to match (see above).
- **Live updates use Server-Sent Events** (`/api/events`, `/api/track/:code/events`): long-lived
  `text/event-stream` responses.
  - The app sends `X-Accel-Buffering: no` and a ping every 25 s.
  - Set the proxy's idle or read timeout above 60 s, and don't buffer or compress these responses.
  - If streams drop, the apps keep working by polling, but updates arrive slower.
- Security headers on the web app: a strict Content-Security-Policy without `unsafe-eval`, allowing
  only Yandex hosts, plus `frame-ancestors 'none'`, `nosniff`, a referrer policy, and a permissions
  policy that allows geolocation only for the app itself.
- Caching: `index.html` is `no-cache`; `/assets/*` files are content-hashed and cached for a year.
  A deploy takes effect on the next page load. Restart the process after rebuilding, because
  `index.html` is read at startup.

## Database migrations

Migrations are versioned SQL in `apps/api/src/db/migrations`. They are **never run automatically**
against a remote database.

1. Review the SQL of any new migration.
2. Take a Neon branch or snapshot as a restore point.
3. Run once, with explicit approval:

   ```bash
   ALLOW_REMOTE_MIGRATIONS=true npm run db:migrate
   ```

4. Deploy the new code **after** the migration. Migrations so far only add things, so the old code
   keeps working in between.

Don't set `ALLOW_REMOTE_MIGRATIONS` in the app's environment. It belongs on the one command line.

Current state: migrations `0000`–`0005` are applied to the Neon production branch, which is
also being used for development. Before launch, create a separate Neon branch for development
and keep `production` for real data.

**Region:** create the production project in **AWS eu-central-1 (Frankfurt)**, the closest Neon
region to Addis Ababa, and host the app in the same region. Every API request makes several
database round trips, so app-to-database latency matters more than browser-to-app latency.

## First admin

After the first deploy, with the server's environment loaded:

```bash
npm run admin:grant -- 0911234567
```

The person then signs in at `/admin` with an SMS code. See [runbook.md](runbook.md).

## Scaling

The app is safe to run as several instances, **except for live updates**:

- The database enforces the business rules: one active delivery per rider, one open offer per
  delivery and per rider, idempotent payments and settlements, and rate limits stored in Postgres.
  Several dispatcher loops running at once are safe.
- The live event hub is **in memory**. An event raised on instance A only reaches browsers
  connected to A. With several instances, either route each user to one instance (sticky sessions)
  and accept slower, poll-only updates otherwise, or add a fan-out (Postgres `LISTEN/NOTIFY` fits
  without new infrastructure). Until then, run **one instance**. One Node process comfortably
  handles the expected launch volume.

## Secrets

- Rotate every key that was pasted into chat during development before launch: the Neon password,
  AfroMessage token, Yandex keys, and the Yandex JS key's domain restriction.
- `.env` files are gitignored. Configuration errors print variable names only.
- Codes are stored only as keyed hashes. Session tokens are stored only as hashes; the raw token
  exists only in the HttpOnly cookie. A database leak exposes neither.

## Pre-launch checklist

- [ ] Real AfroMessage send verified to a test phone. Delivery report checked.
- [ ] `SMS_DAILY_BUDGET` set to match the AfroMessage balance.
- [ ] Separate Neon branch for development; production branch backed up.
- [ ] Secrets rotated (see above).
- [ ] `APP_ORIGIN` = public https origin; sign-in tested on the real domain.
- [ ] Yandex JS key restricted to the production domain.
- [ ] Fares, commission, cancellation fees and service area confirmed. Current fares are
      placeholders.
- [ ] One admin granted; a rider approved; one end-to-end delivery on the real domain.
- [ ] Concurrency test run against a real Postgres branch: `TEST_PG_URL=… npm test -w @dp/api`.
