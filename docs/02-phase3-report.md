# Phase 3 report — Authentication

Date: 2026-10-31

## Built

**API**

- `POST /api/auth/otp/request` — normalizes the phone to `+251…`, reuses an open challenge, sends at
  most one SMS per cooldown, and returns the same shape for new and existing numbers.
- `POST /api/auth/otp/verify` — counts the attempt atomically before comparing (constant-time), and
  locks the phone after 5 wrong codes. On success it consumes the challenge once, creates or reuses
  the single account for that phone, and starts a session.
- `GET /api/auth/me` — restores the session from the cookie. Never sends an SMS.
- `PATCH /api/auth/me` — name and language only. Other fields, such as role, are rejected.
- `POST /api/auth/logout` — revokes the session in the database and clears the cookie.
- `npm run admin:grant -- 09…` — the only way to create an admin. Revokes that user's existing
  sessions. Stop the dev server first when using the local database.

**Sessions**

- An opaque 256-bit token in an `HttpOnly; SameSite=Lax; Path=/` cookie, which is `Secure` and
  `__Host-` prefixed in production. Only its SHA-256 hash is stored.
- Customers and riders: 30 days idle (sliding), 90 days absolute. Admins: 12 hours.
- The last-seen time is written at most once an hour. Suspending a user ends their sessions on the
  next request.

**Abuse and cost controls**

All values are configurable in `.env`.

| Control                                 | Default                                       |
| --------------------------------------- | --------------------------------------------- |
| Code lifetime                           | 5 min                                         |
| Resend cooldown (no SMS sent inside it) | 60 s                                          |
| Wrong codes before lockout              | 5, then the phone is locked 15 min            |
| Sends per phone                         | 3 per 15 min, 6 per day                       |
| Sends per IP                            | 10 per hour                                   |
| Verifications per IP                    | 30 per 15 min                                 |
| Global daily SMS budget (kill switch)   | 500                                           |
| CSRF                                    | Foreign `Origin` → 403. Non-JSON bodies → 415 |

**SMS adapter** (`integrations/sms`)

- `console` prints the code in the dev terminal and is refused in production.
- `fake` is for tests.
- `afromessage` is built but **not verified against the live API**.
- A failure that definitely didn't send lets the user retry at once. An ambiguous failure, such as a
  timeout, keeps the cooldown, so no duplicate SMS goes out.
- Failures are logged with a masked phone number and never the code.
- Messages end with a WebOTP line (`@host #code`) so Android Chrome can offer to fill the code.

**Web**

- Phone → code → name (first sign-in only) → home.
- The code boxes submit automatically at 6 digits. Paste, SMS autofill and WebOTP are supported.
- A resend countdown, translated error messages (attempts left, lockout time, expired code), and a
  "Change number" link.
- Account pages for customer and rider: name, phone, language and sign out. Admin sidebar: user
  and sign out.
- Signing in with the wrong role for an area shows a "switch account" screen.
- Signing out clears every cached query, so data doesn't linger on shared phones.

## Tests: 86 passing (shared 28, API 58)

New in this phase, 45 tests:

- **OTP requests:** one SMS per request; reuse inside the cooldown; resend rotates the code;
  concurrent requests send one SMS; per-phone, per-IP and global-budget limits; no enumeration
  (identical response shape); only a hash is stored; behaviour on definite and on ambiguous send
  failures; cross-site requests blocked.
- **OTP verification:** account created once; single-use codes; concurrent verification creates one
  session; expired codes rejected; attempt countdown and lockout; parallel guesses capped at 5;
  per-IP verify limit; input validation; suspended accounts refused.
- **Sessions:** restore without SMS; survives an API restart; token hashing; 30-day idle expiry;
  sliding refresh; hourly touch; 90-day absolute cap; logout revokes; logout on one device leaves
  other devices signed in; suspension revokes; cross-site logout blocked; profile can't escalate
  role; 12-hour admin sessions.
- **AfroMessage adapter (mocked HTTP):** request format, rejection, 4xx/5xx and timeout handling,
  and no code in error messages.

## Browser verification (375 px phone)

- Phone → code → name → home.
- A wrong code shows "4 attempts left", and focus returns to the first box.
- A reload restores the session with no SMS.
- The session survives a full dev-server restart.
- `/sign-in` redirects home when already signed in.
- A customer opening `/rider` gets the "switch account" screen.
- Signing out makes `/me` return 401. Signing back in skips the name step.
- `document.cookie` is empty, so the session cookie can't be read by page JavaScript.

Fixed during verification:

- Focus was lost after a wrong code. The boxes are now read-only rather than disabled while
  checking, and focus returns to the first box.
- The masked number wrapped across two lines.

## Not done / limits

- **AfroMessage is unverified.** No credentials yet. Field names come from third-party clients.
  Delivery-report callbacks are not implemented yet.
- **Concurrency against real Postgres.** PGlite runs one query at a time, so the concurrency tests
  prove the logic, not real contention. Re-run them against a Neon dev branch.
- **Riders.** Signing in on `/rider` currently creates a _customer_ account. Rider registration and
  the rider role come in Phase 4 and depend on plan questions Q3 and Q4.
- **Admin extra factor (Q6).** Not added; admins sign in with phone OTP only, on 12-hour sessions.
- **"Sign out everywhere"** for users and admin-side session revocation come with the admin tools
  in Phase 4.
- **Amharic copy** still needs a native-speaker review.

## Needed from you

1. **AfroMessage** — an API token, sender name or identifier, and one test phone number. I will
   send a single real SMS only with your go-ahead.
2. **Neon** — dev-branch connection strings, to run migrations (with your approval) and the
   concurrency tests against real Postgres.
3. **Decisions** — plan Q1 (fare formula), Q2 (dispatch model), Q3 and Q4 (rider sign-up and roles)
   and Q5 (`returning` status). These block Phase 4.
4. **Accent colour** — green or amber. Still pending.
