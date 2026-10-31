# Phase 5 report: testing, security and production readiness

Date: 2026-10-31

## Built

**Single-process production serving** (`apps/api/src/web-static.ts`)

- The API serves the built web app with `npm run build` then `npm start`. With one origin, the
  HttpOnly session cookie and live updates need no CORS.
- `index.html` is never cached, so a deploy shows on the next load. Hashed `/assets/*` files are
  cached for a year. Client routes (`/deliveries/…`, `/t/…`, `/admin/…`) fall back to the app. A
  missing asset returns a real 404, and unknown `/api/*` routes still return JSON errors.
- Path-traversal guard, tested with encoded `..`, `%2f` and backslash variants.
- Security headers on the web app:
  - a Content-Security-Policy that allows only our own origin and Yandex Maps hosts, **without
    `unsafe-eval`**. Checked in the browser: the map, markers and route line work with no
    violations.
  - `frame-ancestors 'none'`, `nosniff`, a referrer policy, and a permissions policy that allows
    geolocation for the app only and no camera, microphone or payment access.
- `npm run preview:prod` builds and runs that exact setup locally against the embedded database.

**Hardening**

- **Proxy trust is now explicit** (`TRUST_PROXY`). Before, production trusted every
  `X-Forwarded-For` header. If the app were reachable without its proxy, anyone could fake their IP
  and get around the per-IP sign-in code limits. It now trusts one proxy hop by default, accepts a
  hop count or proxy addresses, and refuses `true`.
- **drizzle-orm 0.44.7 → 0.45.4** fixes a high-severity advisory: SQL injection through escaped
  identifiers. Our code never builds identifiers from user input, but the runtime is now patched.
  `npm audit --omit=dev` reports **0 vulnerabilities**. drizzle-kit confirms the schema still
  matches the migrations.
- `db:migrate` and `admin:grant` now run with plain Node instead of `tsx`, so they work on a
  production install without dev packages. Tested against a scratch database.
- The Node requirement is raised to **22.18**, the first 22.x release that runs `.ts` files without
  a flag, which `npm start` relies on.
- `.env.example` files now cover every variable, including a new `apps/web/.env.example` for the
  public build-time keys.

**Accessibility and layout.** Audited with axe-core against WCAG 2.1 AA and best practices, at
desktop, tablet (768 px) and phone (375 px) widths.

- Fixed:
  - muted text contrast (4.43 → ≥ 4.5:1 on every surface);
  - success badge contrast;
  - unnamed progress bars (now "Delivery progress", translated);
  - empty table headers on action columns (now named for screen readers);
  - headings that skipped levels in empty and error states;
  - the "wrong account" screen, which had no main landmark or page heading;
  - wide admin tables that keyboard users couldn't scroll (now a focusable, labelled region).
- **Admin works on a phone or tablet.** Below 1024 px the sidebar becomes a sticky top bar that
  scrolls sideways, with no horizontal page scroll at 375 px.
- Result: **zero violations** on all three sign-in pages, the customer and rider home screens,
  every admin page, and public tracking. The only remaining finding is inside Yandex's map (its
  logo link has no text), which we can't change.

**Rider:** on the way back from a failed delivery, the rider's screen now asks for the fare, which
the sender pays when the parcel is returned. Before, returned jobs left the screen with no place to
record it.

**Documentation**

- [deploy.md](deploy.md):
  - environment variables, and why `APP_ORIGIN` must be exactly the public https origin;
  - build and start, `HOST=0.0.0.0` in containers, liveness and readiness checks;
  - HTTPS, proxy settings and timeouts for live updates;
  - migrations with approval and a restore point;
  - the Neon region (Frankfurt);
  - scaling limits, secret rotation, and a pre-launch checklist.
- [runbook.md](runbook.md): admins, rider approval, suspension, stuck deliveries, missing riders,
  failed deliveries, cancellation fees, settlements, pricing changes, SMS budget and sign-in
  problems, restarts, resetting local data.

## Checks

| Check                     | Result                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Typecheck, lint, Prettier | pass                                                                                                                                       |
| Tests                     | **161 pass**, 3 opt-in skipped (shared 28, API 133). New: web serving (5), proxy trust settings (1)                                        |
| Build                     | pass. Core bundle 152 kB gzip; admin 10.9 kB, rider 6.7 kB                                                                                 |
| `npm audit --omit=dev`    | 0 vulnerabilities                                                                                                                          |
| Accessibility (axe)       | 0 violations on all app pages at 375 px and 1280 px (third-party Yandex logo excluded)                                                     |
| Production preview        | Served from one process on port 3000. Sign-in, admin pages, tracking and the map worked under the strict CSP; readiness check returned 200 |

## Not done / limits

**Needs you**

- **AfroMessage is not verified.** No real SMS has been sent. I need a test phone number and your
  go-ahead for one send.
- **Real-Postgres race test not run.** `test/concurrency.pg.test.ts` checks the one-active-job
  rule and double-accept races against real Postgres. It creates test users with numbers starting
  `+2519009…` and deletes them afterwards. It needs your approval to run against Neon.
- **Secrets shared in chat should be rotated** before launch: the Neon password, AfroMessage token
  and Yandex keys.
- **Business defaults still open** (plan questions Q1–Q5):
  - fares are placeholders: motorcycle 60 + 18/km, minimum 80; bicycle 40 + 12/km, minimum 50,
    maximum 8 km;
  - the service area is the 11 sub-cities;
  - the brand name and accent colour (green or amber) are undecided.
- **Neon production is also the development database.** Create a separate development branch
  before real users arrive.

**Known gaps**

- **Live updates need one instance.** The event hub is in memory. More instances need sticky
  sessions or a Postgres `LISTEN/NOTIFY` fan-out (see deploy.md).
- **Distances are straight-line estimates** with a road factor. There is no routing key.
- **Rider GPS stops when the phone screen is off.** This is a browser limit; a native app or PWA
  wrapper would be needed.
- **Missing admin screens:**
  - a fare that wasn't recorded at the time;
  - ledger corrections;
  - removing admin rights;
  - a full audit log view. Audit entries show on each delivery.
- **Admin is English only.** Customer and rider are English and Amharic; the Amharic needs review
  by a native speaker.
- **Development tooling advisories:** vitest 3 (critical, in its worker pool), eslint 9 (end of
  life) and drizzle-kit's bundled esbuild loader. None of these ship to production; upgrading needs
  vitest 5 and eslint 10, a separate change.
- The core bundle is about 150 kB gzip, mostly React, the router and zod. It is acceptable on 3G,
  but zod could be split later.
- The rider's return payment prompt is covered by the API test but wasn't clicked through in the
  browser, because a failed delivery needs a 10-minute wait.
