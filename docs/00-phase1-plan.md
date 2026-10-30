# Phase 1 Plan — Addis Ababa Parcel Delivery Platform (working name, brand TBD)

Status: **PROPOSAL — awaiting approval. No code, no repo, no database changes yet.**
Date: 2026-10-30

Source of truth: the product specification provided in chat. No Antigravity source code was opened or used.
Visual reference: 5 screen recordings of third-party apps (ride-hailing booking, parcel tracking, food-delivery tracking) — reviewed for interaction patterns only, nothing copied.

---

## 0. What I took from the reference videos

| Pattern seen | Keep / Adapt / Reject | How it applies here |
|---|---|---|
| Map fills the screen, content lives in a draggable **bottom sheet** | **Keep** | Customer booking and tracking, rider active-job screen |
| Booking as a short **stepper** (Route → Payment → Vehicle) with one pinned primary button | **Adapt** | Route → Parcel & payer → Vehicle & fare → Confirm. One CTA, always at the thumb |
| "Where to?" sheet: *Use current location*, Recent, Suggested; swap ↕ pickup/drop-off | **Keep** | Plus saved places and pin-drop "Confirm location" for addresses Yandex can't geocode (common in Addis) |
| Top status pill ("Driver on the way · 3 min") + big ETA tile | **Keep** | Status pill + ETA, driven by real rider GPS, not a fake timer |
| **Segmented progress bar** (Confirmed · Preparing · Picked up · On the way · Delivered) | **Keep** | Maps 1:1 to our state machine |
| Rider card: photo, rating, vehicle, **plate badge**, Call + Message | **Keep** | Call uses `tel:`; plate badge important for motorcycles; bicycle shows rider ID instead |
| Vertical **status timeline with timestamps** | **Keep** | Customer tracking + admin delivery detail (from audit log) |
| "Finding your driver" with radar + nearby count, *Cancel search* | **Adapt** | Show honest state ("Offering to riders near you"); no fake avatars |
| inDrive-style **fare counter-offers** (driver asks +$6.30, Accept/Decline) | **Reject for v1** | Fixed platform fare is simpler, auditable, and matches the commission rules. Could revisit later |
| Card / Apple Pay / Google Pay picker | **Reject** | Cash · Telebirr · CBE Birr, recorded as *how the rider was paid*, plus Payer: Sender / Receiver |
| Home with "This Week" bar charts, promo banners, 3D mascots, flags, isometric fake city maps | **Reject** | This is exactly the "decorative dashboard" look the spec rules out |
| Email/password + Google/Apple login | **Reject** | Phone + OTP only |
| Tracking-number search, parcel list with filter chips (All / In transit / Delivered) | **Keep** | Customer "My deliveries"; receiver can track via a public tracking link (no login) |

Net: the reference apps get the **flow** right (map + sheet + stepper + live status). Our design will take that structure and pair it with a calmer, more utilitarian visual system (section 6).

---

## 1. Proposed fresh repository structure

New, independent Git repository at `E:\Personal\delivery app_New` (currently empty). Existing project untouched.

```
delivery-platform/
├─ apps/
│  ├─ api/                         # Fastify + TypeScript backend (modular monolith)
│  │  ├─ src/
│  │  │  ├─ app.ts                 # builds Fastify instance (plugins, routes) — testable
│  │  │  ├─ server.ts              # listens; attaches Socket.IO
│  │  │  ├─ config/                # env schema (zod), typed config
│  │  │  ├─ db/                    # pool, transaction helper, schema, migrations/
│  │  │  ├─ modules/               # one folder per business module:
│  │  │  │  ├─ auth/               #   routes.ts · service.ts · repo.ts · schemas.ts · *.test.ts
│  │  │  │  ├─ users/
│  │  │  │  ├─ riders/
│  │  │  │  ├─ pricing/
│  │  │  │  ├─ deliveries/         #   state machine lives here
│  │  │  │  ├─ dispatch/           #   offers + assignment
│  │  │  │  ├─ tracking/           #   location ingest + Socket.IO rooms
│  │  │  │  ├─ payments/           #   payment records, rider ledger
│  │  │  │  └─ admin/
│  │  │  ├─ integrations/          # external adapters only, behind interfaces
│  │  │  │  ├─ sms/                #   SmsProvider: afromessage.ts · console.ts (dev) · fake.ts (test)
│  │  │  │  └─ maps/               #   GeoProvider: yandex.ts · fake.ts
│  │  │  └─ shared/                # errors, phone normalization, money, ids, rate limiter
│  │  └─ test/                     # integration tests (real Postgres)
│  └─ web/                         # React + Vite + Tailwind, three surfaces in one app
│     └─ src/
│        ├─ surfaces/
│        │  ├─ customer/           # routes, layouts, screens — mobile-first
│        │  ├─ rider/              # routes, layouts, screens — Android-first, installable PWA
│        │  └─ admin/              # routes, layouts, screens — desktop-first
│        ├─ ui/                    # design-system components (Button, Sheet, Field, Table…)
│        ├─ map/                   # Yandex map wrapper, markers, route layer
│        ├─ lib/                   # api client, session bootstrap, socket client, i18n
│        └─ styles/                # tokens.css (colors, type, spacing, radii)
├─ packages/
│  └─ shared/                      # types + zod schemas + enums shared by api and web
│                                  # (DeliveryStatus, VehicleType, PaymentMethod, API DTOs)
├─ docs/                           # plans, ADRs, runbooks, API notes
├─ docker-compose.yml              # local Postgres 16 for dev/tests (Neon for shared envs)
├─ .env.example                    # names only, never values
├─ pnpm-workspace.yaml
└─ package.json
```

Why one web app for three surfaces: shared design system and API client, one build pipeline. Each surface is its own **lazy-loaded route tree** (`/`, `/rider`, `/admin`) with its own layout, navigation and role guard, so code for admin never ships to a customer's phone and permissions are enforced server-side regardless. If the rider app later needs to become a native wrapper (see risk R3), `surfaces/rider` lifts out cleanly.

---

## 2. System architecture

```
 Customer PWA ─┐                         ┌──────────── Neon PostgreSQL
 Rider PWA  ───┼── HTTPS REST ──┐        │   (users, sessions, deliveries,
 Admin web  ───┘                ▼        │    payments, audit, rate limits)
                       ┌──────────────────┴──┐
   WebSocket ─────────►│  Fastify API        │──► SmsProvider ──► AfroMessage
   (Socket.IO)         │  modular monolith   │──► GeoProvider ──► Yandex Geocoder / Router
                       │  + Socket.IO server │
                       └─────────────────────┘
 Browser map tiles ───────────────────────────────► Yandex Maps JS API (client side)
```

**Stack (proposed, compatibility to be confirmed in Phase 2 with exact versions):**

| Layer | Choice | Justification |
|---|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, React Router, TanStack Query | As specified. TanStack Query handles loading/error/retry states consistently |
| Forms/validation | react-hook-form + zod (schemas from `packages/shared`) | Same validation on client and server |
| Backend | Node 22 LTS, Fastify 5, TypeScript | As specified. Fastify's schema validation and plugin model fit a modular monolith |
| DB access | **Drizzle ORM + drizzle-kit migrations**, raw SQL where needed | Typed queries, versioned SQL migration files you can review before they run. Partial unique indexes and CHECK constraints written explicitly in SQL |
| Database | PostgreSQL on Neon (dev branch for development), local Postgres in Docker for tests | Tests never touch Neon |
| Real-time | **Socket.IO** attached to Fastify's HTTP server | Rooms map naturally to `delivery:{id}`, `rider:{id}`, `admin`; auto-reconnect matters on Addis mobile networks. Server stays the single writer — sockets only broadcast what the DB already committed |
| Auth | Opaque session tokens in `Secure; HttpOnly; SameSite=Lax` cookie; hash stored in `sessions` | Revocable server-side, no JWT in JS storage |
| Tests | Vitest (unit + API integration via `fastify.inject`), Playwright (responsive UI smoke) | |
| i18n | English + Amharic from day one (Noto Sans Ethiopic font) | Strongly recommended for Addis customers and riders |

**Layering rule inside every module:** `routes` (HTTP only, validation, auth guard) → `service` (business rules, transactions) → `repo` (SQL only). Integrations are only called from services through interfaces. Socket emits happen **after** the transaction commits.

---

## 3. Database entity plan

Conventions: `uuid` PKs, `timestamptz` everywhere, money `NUMERIC(12,2)`, coordinates `NUMERIC(9,6)`, enums as Postgres enums or CHECK constraints.

**Identity & auth**
- `users` — id, phone_e164 **UNIQUE**, full_name, role (`customer`|`rider`|`admin`), status (`active`|`suspended`), preferred_language, created_at, phone_verified_at.
  *One phone = one user.* Role per user for v1 (a rider who also sends parcels: see open question Q4).
- `otp_challenges` — id, phone_e164, purpose (`login`), code_hash (HMAC-SHA256 with server secret), expires_at, attempts, max_attempts, send_count, last_sent_at, consumed_at, ip, created_at. Partial unique index: one *open* challenge per phone+purpose.
- `sms_messages` — id, provider, phone_e164, purpose, provider_message_id, status (`queued`|`sent`|`failed`|`delivered`), error_code, cost (nullable), created_at. **Never stores the OTP or message body containing it.**
- `sessions` — id, user_id, token_hash UNIQUE, created_at, last_seen_at, expires_at (sliding), absolute_expires_at, revoked_at, revoke_reason, user_agent, ip.
- `rate_limit_buckets` — key (e.g. `otp:phone:+2519…`, `otp:ip:1.2.3.4`), window_start, count. Postgres-backed so it works across restarts and multiple instances without adding Redis yet.
- `auth_lockouts` — phone_e164 / ip, locked_until, reason.

**Riders**
- `riders` — user_id PK/FK, vehicle_type (`motorcycle`|`bicycle`), plate_number (required for motorcycle), national_id_ref / license_ref (document references, not images in DB), approval_status (`pending`|`approved`|`rejected`|`suspended`), is_online, current_lat, current_lng, location_updated_at.
- `rider_location_pings` — rider_id, delivery_id (nullable), lat, lng, accuracy_m, recorded_at. Retained N days (policy TBD).

**Deliveries**
- `places` — saved places per user (label, address_text, lat, lng, sub_city).
- `deliveries` — id, public_code (short, for tracking links), customer_id, rider_id (nullable), vehicle_type, status, payer (`sender`|`receiver`),
  pickup_{address,lat,lng,sub_city,contact_name,contact_phone,notes}, dropoff_{…same},
  parcel_description, parcel_size,
  distance_km NUMERIC(8,2), duration_min,
  **fare_amount**, **commission_rate** NUMERIC(5,4), **commission_amount**, **rider_earning**,
  cancellation_fee, cancellation_commission_amount, cancelled_by, cancel_reason,
  pricing_rule_id, timestamps per milestone (assigned_at, arrived_pickup_at, picked_up_at, …), created_at, updated_at, version (optimistic lock).
  - **One active delivery per rider (DB-level):**
    `CREATE UNIQUE INDEX one_active_delivery_per_rider ON deliveries(rider_id) WHERE status IN ('assigned','arrived_pickup','picked_up','arrived_dropoff');`
    Concurrent assignments → second insert/update fails on the index → API returns 409. Backend also locks the rider row (`SELECT … FOR UPDATE`) inside the assignment transaction.
  - CHECK constraints: commission_amount = round(fare × rate, 2); rider_earning = fare − commission; coordinates within Addis bounding box.
- `delivery_events` — append-only audit: delivery_id, from_status, to_status, actor_user_id, actor_role, lat, lng, metadata jsonb, created_at.
- `delivery_offers` — delivery_id, rider_id, status (`offered`|`accepted`|`declined`|`expired`), offered_at, expires_at.
- `contact_attempts` — delivery_id, rider_id, attempted_at, outcome (`no_answer`|`busy`|`answered`). Backs the failed-delivery rule.

**Pricing & money**
- `pricing_rules` — vehicle_type, base_fare, per_km, minimum_fare, commission_rate (0.15 / 0.10), cancellation_fee_after_arrival (40 / 25), effective_from, effective_to, created_by. Deliveries reference the rule they were priced with — changing rates never rewrites history.
- `payments` — delivery_id, kind (`fare`|`cancellation_fee`), amount, method (`cash`|`telebirr`|`cbe_birr`), payer (`sender`|`receiver`), status (`due`|`collected`|`disputed`|`waived`), collected_by_rider_id, reference (Telebirr/CBE txn ref, optional), **idempotency_key UNIQUE**, recorded_at.
- `rider_ledger_entries` — rider_id, delivery_id, type (`commission_owed`|`settlement_paid`|`adjustment`), amount (signed), created_by, idempotency_key UNIQUE. Since customers pay riders directly, this is what the rider owes the platform. Admin reconciliation reads from here.
- `settlements` — rider_id, amount, method, reference, period, recorded_by, created_at.

**Admin**
- `admin_audit_log` — actor, action, target_type, target_id, before/after jsonb, ip, created_at.
- `service_areas` — the 11 sub-cities (name_en, name_am, active). Polygons optional later.

---

## 4. Phone OTP and persistent-session flow

**Phone normalization** (`shared/phone.ts`, with tests): accept `09XXXXXXXX`, `07XXXXXXXX`, `9XXXXXXXX`, `+2519…`, `2519…`, spaces/dashes. Output E.164 `+2519XXXXXXXX` or `+2517XXXXXXXX` (Ethio Telecom / Safaricom Ethiopia). Reject everything else. Use `libphonenumber-js` plus explicit Ethiopian prefix rules.

**Request OTP — `POST /auth/otp/request {phone}`**
1. Normalize; reject invalid with a field error (format errors are not enumeration risks).
2. Check lockout and rate limits — per phone (e.g. 3 sends / 15 min, 6 / 24 h), per IP (e.g. 10 / hour), global daily SMS budget cap (kill switch for cost control).
3. If an **open, unexpired challenge** exists:
   - inside resend cooldown (60 s) → no SMS; return `{ retryAfterSec }`.
   - after cooldown → rotate code on the same challenge, increment `send_count`, send once.
4. Else create challenge: 6-digit code from CSPRNG, store `HMAC-SHA256(secret, challengeId‖code)`, expiry 5 min, max 5 attempts.
5. Send via `SmsProvider` **once**, recording an `sms_messages` row (no code). Provider timeout ≠ retry: a delayed delivery report never triggers another send; only an explicit user "Resend" after cooldown does.
6. Response is identical whether the number is new or existing (`{ challengeId, resendAfterSec, expiresInSec }`) — no enumeration.

**Verify — `POST /auth/otp/verify {challengeId, code}`**
1. Load challenge; reject if expired / consumed / attempts exhausted (generic "Code is invalid or expired").
2. Increment attempts **before** comparing; constant-time compare.
3. 5 failures → challenge dead + phone lockout 15 min (escalating).
4. Success → in one transaction: consume challenge, upsert user by `phone_e164` (UNIQUE prevents duplicates even under concurrent verifies), set `phone_verified_at`, create session.
5. Set cookie `sid=<random 256-bit>`; `Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=30d`. DB stores only `sha256(token)`.
6. New users are sent to a one-screen profile step (name) after verification.

**Session restore (app open / refresh)**
- Web calls `GET /auth/me` on boot. Cookie is sent automatically → server looks up `token_hash`, checks not revoked, not expired, user not suspended → returns user + role. **No SMS.**
- Sliding expiry: `last_seen_at`/`expires_at` extended at most once per hour per session (cheap). Absolute cap 90 days → then a new OTP.
- Suspended user or revoked session → 401 → client clears in-memory state and shows login.

**Logout** — `POST /auth/logout` revokes session row and clears the cookie. Admin can revoke all sessions for a user.

**CSRF** — SameSite=Lax + require `Content-Type: application/json` + Origin check on state-changing requests.

**Admin accounts** — same phone OTP for v1, but shorter session (12 h) and admin role is only granted via a seed script / existing admin, never self-registration. (Q6: do you want an additional factor for admins?)

**Rider separation** — riders log in with the same OTP mechanism *to open a session* (that is account login, not a per-action step). Rider operations (accept, arrive, pick up, deliver, fail) require **only** the active session + rider role + approved status. No OTP per action, per status change or per completion. Whether riders must verify their phone at *registration* is left as a separate policy (Q3) — I will not implement it without your approval.

Nothing auth-related is stored in localStorage. Local storage is only used for UI conveniences (language, last-used pickup).

---

## 5. External API integration plan

All items below are **unverified until tested**; Phase 2/3 includes a verification spike for each, and I'll report results before relying on them.

**Neon PostgreSQL**
- Need: a connection string for a **new development branch** (not main). Read-only first: I'll list schemas/tables in the existing DB and report before proposing anything. No migrations against any existing database without your approval.
- Use pooled connection string for the API, direct string for migrations.

**AfroMessage (SMS)**
- Behind `SmsProvider { send(to, text, meta) → {providerMessageId, status} }`.
- To verify: send endpoint and auth (bearer token), sender ID / identifier approval, Ethio Telecom **and** Safaricom delivery, per-SMS cost, delivery report/callback availability, rate limits, and whether their built-in OTP "challenge" endpoint is preferable. My default: **we generate and verify the code ourselves** and use them only as a transport, so switching providers changes nothing else.
- Dev uses `ConsoleSmsProvider` (logs "OTP sent to +2519…**34**", code only shown in local dev terminal); tests use a fake. Production refuses to boot with the console provider.
- Need from you: AfroMessage API token + approved sender name, and a test phone number.

**Yandex Maps**
- Client: Maps JavaScript API (v3) for map display, markers, route polyline.
- Server: Geocoder API (address search / reverse geocoding), Router / Distance Matrix API (distance + duration for fare).
- To verify before building on it: **coverage and street/POI detail for Addis Ababa** (my main concern — addresses in Addis are landmark-based, so pin-drop + landmark notes are first-class regardless), commercial licence terms (free tiers typically restrict commercial use and vehicle tracking/dispatch), pricing per request, key restrictions by domain.
- Behind `GeoProvider` so routing can fall back to straight-line distance × road factor if the router is unavailable, and so a provider swap is possible if coverage is poor.
- Need from you: Yandex developer account / API keys (JS API key + HTTP Geocoder key), and a decision if their licence needs a paid plan.

**Real-time — Socket.IO**
- Auth on handshake using the same session cookie. Rooms: `delivery:{id}` (customer + assigned rider + admins), `rider:{id}` (offers), `admin:ops`.
- Rider sends location every ~5–10 s while on a job (HTTP fallback `POST /rider/location` if the socket is down). Server writes, then broadcasts throttled updates.

**Payments — Telebirr / CBE Birr**
- v1 = **records only**: rider marks "Payment collected: Cash / Telebirr / CBE Birr (+ optional reference)". Idempotent by key. No gateway, and the UI will not imply automatic payment.
- Gateway integration is a later phase pending official merchant API access.

---

## 6. UI direction

**Visual system (distinct from both the old app and the reference videos)**
- Tone: calm, utilitarian, high-contrast, made for sunlight on a mid-range Android phone.
- Palette: near-black ink + warm off-white surfaces, **one** signal color for primary actions and the live state (proposal: a deep green or a strong amber — I'll show 2 options in Phase 2), plus semantic red/amber/green for status only. Dark mode for riders at night.
- Type: Inter (Latin) + Noto Sans Ethiopic (Amharic); large numerals for ETA and money ("185.00 ETB").
- Components: bottom sheet, stepper, segmented status bar, timeline, rider card, list rows, data table with filters, toast, skeletons, empty and error states. 44px+ touch targets, visible focus, no color-only status.
- Motion: only sheet drag, marker movement, and loading skeletons.

**Customer (mobile-first)**
1. *Sign in*: phone field with +251 prefix → OTP screen (6 boxes, auto-advance, resend countdown).
2. *Home* = map + sheet: "Send a parcel" with pickup (current location) / drop-off, recent places, active delivery banner if one exists. No charts, no promos.
3. *Book* stepper: **Route** (search / pin-drop / swap) → **Parcel** (what, size, receiver name + phone, notes) → **Vehicle & payer** (Motorcycle vs Bicycle with fare + ETA each; Payer: Sender / Receiver; method Cash / Telebirr / CBE Birr) → **Confirm** (summary, fare breakdown, cancellation rule stated in plain words).
4. *Finding a rider* → *Tracking*: map, status pill, ETA, segmented bar (Assigned · At pickup · Picked up · At drop-off · Delivered), rider card with plate and Call, timeline, Cancel (shows the fee if rider has arrived).
5. *My deliveries*: list with filter chips; detail with receipt.
6. Public *receiver tracking link* `/t/{public_code}` — read-only, no login.

**Rider (Android-first PWA, one-hand use)**
1. Sign in → *Registration* (vehicle type, plate, documents) → "Pending approval" state.
2. *Home*: large **Go online / offline** toggle, today's earnings and amount owed to platform, current job if any.
3. *Incoming offer*: full-screen card — pickup distance, route distance, fare, rider earning, countdown, Accept / Decline.
4. *Active job*: map + one big context button that advances the state ("I've arrived at pickup" → "Parcel picked up" → "Arrived at drop-off" → "Delivered"), Call sender / receiver, Navigate (opens Yandex Navigator / Maps app via deep link).
5. *Can't reach receiver*: logs each call attempt; "Mark failed" unlocks only after 3 attempts spanning ≥ 10 min, then guides the return to sender → "Returned".
6. *Collect payment*: method + optional reference. *Earnings*: history and settlements.

**Admin (desktop-first, real data only)**
- *Live operations*: map of online riders and active deliveries + a table of deliveries needing attention (unassigned > N min, stuck in a state, failed).
- *Deliveries*: filterable table → detail with timeline, audit events, payments, manual reassign / cancel with reason.
- *Riders*: applications queue (approve / reject / suspend), profile, ledger.
- *Reconciliation*: per-rider commission owed vs settled, record settlement, export CSV.
- *Pricing*: view/edit pricing rules (versioned, effective dates).
- *Users*: search by phone, suspend, revoke sessions.
- Empty states say what to do ("No riders online. Riders appear here when they go online.") — never fake numbers.

---

## 7. Business rules — implementation notes

**Delivery state machine**

```
requested ─► assigned ─► arrived_pickup ─► picked_up ─► arrived_dropoff ─► delivered
    │            │              │                              │
    └─cancelled◄─┘ (fee 0)      └─► cancelled (fee 25/40,      └─► failed ─► returning ─► returned
       (by customer/admin,           0% commission,                 (≥3 calls over ≥10 min;
        no rider yet or               rider keeps all)               fare stays due, no return fee)
        rider not arrived)
```

- Transitions are validated in one place (`deliveries/stateMachine.ts`), each writes a `delivery_events` row, and uses optimistic locking (`version`).
- **Cancellation:** fee is decided by status at cancel time — before `arrived_pickup`: 0 ETB, 0%; from `arrived_pickup` (before `picked_up`): bicycle 25 / motorcycle 40 ETB, commission 0, rider earning = full fee. After pickup, customer cancellation is not allowed (Q8).
- **Failed delivery:** fare_amount stays due; payment row `kind=fare` remains `due` (who pays it on return — Q7).
- **Commission:** rate copied from the pricing rule at booking time onto the delivery row; amounts computed in integer cents, stored NUMERIC(12,2).
- **Payment idempotency:** client generates idempotency key per "record payment" action; duplicate submits return the original record.

---

## 8. Phased roadmap

Each phase ends with a report: what was built, tests that passed, what's incomplete, what I need from you.

| Phase | Scope | Exit criteria |
|---|---|---|
| **1. Planning** (this doc) | Architecture, data model, flows, UI direction | Your approval + answers to open questions |
| **2. Foundation** | `git init`, pnpm monorepo, Fastify skeleton with health check, config validation, Drizzle + first migration (users, sessions, otp, rate limits) applied to **local Docker Postgres**, Vite app with three route trees and role-guard stubs, design tokens + core components (Button, Field, Sheet, Stepper, Table, Toast), EN/AM i18n setup, lint/format/typecheck/test scripts. Read-only inspection of Neon (when credentials given) | `pnpm dev` runs api + web; typecheck, lint, tests green; design-system preview page; Neon inspection report |
| **3. Authentication** | Phone normalization, OTP request/verify, rate limits, lockouts, SMS adapter (console + AfroMessage), sessions, `/auth/me`, logout, revocation, suspension; customer sign-in UI | Abuse-protection tests (cooldown, limits, attempts, lockout, enumeration), session persistence across restart, one real AfroMessage send to your test phone (with approval) |
| **4a. Booking & pricing** | Places, geocoding, route distance, pricing rules, fare quote, booking stepper UI | Pricing unit tests, Yandex spike report |
| **4b. Dispatch & delivery lifecycle** | Rider registration/approval, online status, offers, assignment, state machine, cancellation, failed/return flow, rider app screens | Concurrency test: N parallel assigns to one rider → exactly 1 succeeds; state-machine tests |
| **4c. Tracking** | Socket.IO, location ingest, customer tracking screen, public tracking link | Live update test, reconnect behaviour |
| **4d. Payments & admin** | Payment records, rider ledger, settlements, admin ops, deliveries, riders, reconciliation, pricing editor, audit log | Idempotency tests, permission tests (customer can't hit rider/admin endpoints, etc.) |
| **5. Hardening** | Playwright responsive checks (360 px Android, desktop admin), accessibility pass, production build, security headers, HTTPS/deploy notes, seed + runbooks | Full test suite + prod build green; known-gaps list |

---

## 9. Open questions (need your answers before or during Phase 2)

1. **Fare formula** — the spec gives commission and cancellation fees but not the fare itself. Proposal: `max(minimum, base + per_km × road_km)` per vehicle type. What starting numbers (ETB) for base / per-km / minimum, motorcycle and bicycle? Bicycle max distance?
2. **Dispatch model** — (a) system offers the job to the nearest available rider with a 20 s accept window, then the next; or (b) riders see a job board and claim. I recommend (a).
3. **Rider phone verification at registration** — required or not? (Separate policy; won't implement without approval.)
4. **Can one phone number be both a customer and a rider?** Simplest is one role per account for v1.
5. **"Returning" status** — should a rider returning a failed parcel count as *active* (blocking new jobs)? I recommend **yes**, i.e. add `returning` to the active set enforced by the unique index. Your spec lists only four active statuses, so I need your confirmation.
6. **Admin login** — phone OTP only, or OTP + an extra factor / IP allow-list?
7. **Failed delivery payment** — the fare stays due; who pays it — always the sender, or whoever was the payer?
8. **Cancellation after pickup** — confirm customers cannot cancel once the parcel is picked up (admin-only intervention).
9. **Repository** — OK to `git init` a new standalone repo in `E:\Personal\delivery app_New`? Should I also create a new GitHub repo (name?), or keep it local for now?
10. **Languages** — English + Amharic from the start?
11. **Working name** — a neutral placeholder (e.g. "Parcel") in the UI until the brand is decided?

## 10. Credentials / access needed (later, not now)

- Neon: connection strings for a **new dev branch** (pooled + direct). Put them in `apps/api/.env` yourself; I'll only reference variable names.
- AfroMessage: API token, sender identifier, a test phone number.
- Yandex: JS API key and Geocoder/Router keys, plus licence tier.
- Docker Desktop (or a local Postgres 16) for isolated tests.

## 11. Risks

- **R1 Yandex coverage in Addis** may be thin for streets/POIs → pin-drop + landmark notes are core features; GeoProvider abstraction allows a swap.
- **R2 Yandex licence** may require a paid plan for commercial tracking use.
- **R3 Browser background GPS**: a PWA cannot reliably send location when the rider's screen is off. Mitigation: keep-awake on active job screen for v1; plan a Capacitor (Android) wrapper of the rider surface if field tests show gaps.
- **R4 SMS deliverability** across Ethio Telecom and Safaricom must be tested with real numbers.
- **R5 Direct payment to riders** means commission collection depends on reconciliation discipline; ledger + admin tooling is a priority, not an afterthought.
