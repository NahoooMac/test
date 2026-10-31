# Phase 4c report — Live tracking

Date: 2026-10-31

## Decision: Server-Sent Events instead of Socket.IO

The plan allowed "Socket.IO or another justified real-time mechanism". SSE was chosen because:

- updates only flow server → client; riders already send their position through the REST API;
- it uses the same HTTPS origin and the same HttpOnly session cookie, so there's no separate auth;
- browsers reconnect automatically, which matters on mobile networks;
- there's no new dependency, which matters given this machine's very slow package installs.

Every event is a **signal**: the client refetches from the API, or patches a rider position in
place. A missed event therefore only costs latency. Polling stays on as a backstop: every 30–60 s
while live, and back to 4–15 s if the stream drops.

**Limit:** connections live in one API process. With several API instances, fan-out needs a shared
channel; Postgres `LISTEN/NOTIFY` is the natural choice with Neon. A single instance doesn't need it.

## Built

No database changes this phase, so no migration.

**API**

- `GET /api/events` — the signed-in stream. The hub routes each event by user and role:
  - **customer:** their own deliveries;
  - **rider:** their own offers and job;
  - **admin:** everything.
    A heartbeat every 25 s keeps it open through proxies. Logging out closes that session's streams.
- **Events:**

  | Event      | Sent when                                                      |
  | ---------- | -------------------------------------------------------------- |
  | `delivery` | Status changes: book, accept, each step, release, fail, cancel |
  | `location` | The rider on a job moves (customer, admin and public page)     |
  | `offer`    | An offer is sent, lapses or is withdrawn                       |
  | `rider`    | An approval decision is made                                   |
  | `ops`      | Something changes on the admin board                           |

- `GET /api/track/:code` and `/api/track/:code/events` — **public tracking**, no sign-in.
  - Shows status, route areas, ETA and timeline.
  - Shows the rider's first name and plate.
  - Shows the rider's phone **only while the rider is on the way**.
  - Shows the rider's position only during an active job.
  - **Never** shows sender or receiver phone numbers, or prices.
  - Rate limited per IP (60 views and 20 streams per minute). Unknown codes return 404.
- `GET /api/admin/ops` — the operations snapshot: online riders (available, offer pending, on a
  job; GPS age), open deliveries, and a flag on anything waiting more than 5 minutes for a rider.
- The customer delivery view now includes `riderLocation` while the job is active.

**Web**

- One live stream per signed-in app. Signals refresh the right screens, and positions patch the map
  without a refetch. The connection status lowers polling while live.
- **Customer delivery screen:** a live rider marker, and **Share tracking link** (the phone's share
  sheet, or copy to clipboard).
- **`/t/:code` public tracking page:** map with a live rider marker, status, progress, rider card
  with a Call button while active, timeline, and English/Amharic.
- **Admin Live operations** is now the admin home:
  - a live indicator;
  - four counters (online, available, waiting, in progress);
  - a "waited over 5 minutes" alert;
  - a map of riders and waiting pickups;
  - a rider list with state and GPS age;
  - an open-deliveries table.

## Checks

| Check                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck, lint, Prettier   | pass                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Tests                       | **144 pass**, 3 opt-in skipped (shared 28, API 116). 7 are new: hub routing (customer, rider, admin and public get it; another customer and another code don't), revoked session closed; a real HTTP stream receives a `delivery` event on cancel and ends on logout; public tracking hides phones and prices, and shows rider phone and position only while active; 404 and rate limit; ops board flags a long wait and is admin-only |
| Build                       | pass. Tracking page 1.8 kB gzip, admin 5.3 kB, rider 6.2 kB, customer 4.1 kB                                                                                                                                                                                                                                                                                                                                                           |
| Live, on the local database | Rider went online and appeared on the admin board **~250 ms** later; job steps reached the public tracking page in **~240–250 ms** each; the rider marker moved on location updates; the page reached Delivered and hid the rider's phone, all without reloading                                                                                                                                                                       |

Fixed during verification: the ETA row on the tracking page was labelled "Choose a vehicle".

## Found during verification

**A delivery can get stuck when no new rider is available.** A rider whose offer lapsed or was
declined is never re-offered the same job, by design. With only one rider online, the delivery
waits indefinitely. The ops board now flags it after 5 minutes, but admins need a **"re-offer /
assign manually"** action. This is planned for Phase 4d (admin tools).

## Not done / limits

- Fan-out is single-process (see above).
- The tracking code is 6 characters (about 887 million combinations) plus rate limiting. That's
  adequate for a tracking link, but a longer code is easy if wanted.
- Browser GPS still stops when the screen is off; Wake Lock is in place (plan R3).
- No database migration this phase; nothing to apply to Neon.
