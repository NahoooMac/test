# Phase 4b report — Riders and dispatch

Date: 2026-10-31

## Defaults applied (plan questions not yet answered)

- **Q2 dispatch:** each job is offered to the nearest eligible rider, who has **20 s** to accept,
  then it moves to the next rider. Settings: radius 7 km; GPS fix must be under 2 minutes old.
- **Q3:** riders sign in with the same phone OTP as everyone else. There is no extra registration
  check.
- **Q4:** one role per account. A number that has booked deliveries cannot become a rider.
- **Q5:** `returning` counts as active, so the rider gets no new jobs until the parcel is returned.

## Built

**Database** — migration `0004_dispatch`, which only adds things:

- `delivery_offers`, enforced by the database:
  - one open offer per delivery;
  - one open offer per rider;
  - a rider is never asked twice for the same delivery.
- `contact_attempts`: the call log behind the failed-delivery rule.
- Three new columns on `riders`: `reviewed_by`, `reviewed_at`, `rejection_reason`.

**Dispatcher** (`modules/dispatch/dispatcher.ts`)

- Picks the nearest approved, online rider with a matching vehicle and a recent GPS fix, who has no
  active job and no open offer.
- Runs right after booking, after a decline or release, and every 3 s. Each run lapses expired
  offers and re-offers waiting deliveries.
- Correct with several API instances running, because the database indexes, not the process,
  prevent double offers and double assignment.

**Rider API**

- `POST /rider/apply` and `GET /rider/home` (profile, open offer, active job).
- `POST /rider/status`: only approved riders can go online. Going offline withdraws an open offer.
- `POST /rider/location`: at most 30 per minute.
- Accept and decline offers. Accepting is one transaction: claim the offer, then assign the
  delivery. A busy rider gets `RIDER_BUSY`, and a lapsed or withdrawn offer gets `OFFER_GONE`.
- Job steps: arrived at pickup → picked up → arrived at drop-off → delivered. Each step is checked
  by the state machine, protected by an optimistic lock, and recorded as an event with the rider's
  position when available.
- Release: before pickup only. The job goes back to dispatch and is not re-offered to the same rider.
- **Failed delivery:** call attempts can only be logged at the drop-off. Marking failed needs
  **at least 3 unanswered calls spanning at least 10 minutes**; answered calls don't count. The
  delivery then goes to `failed`, then `returning`, then `returned`. The fare stays due and there is
  no return fee.
- When a customer cancels, any open offer for that delivery is withdrawn.

**Admin API**

- `GET /admin/riders?status=`.
- `POST /admin/riders/:id/decision` to approve, reject, suspend or reinstate. Reject and suspend
  need a reason the rider sees. Suspending takes the rider offline and withdraws their open offer.

**Rider app** (`/rider`, Android-first, dark mode)

- A new account sees the application form. Pending, rejected and suspended riders see their status.
- A large online/offline switch and a GPS status line. A blocked location gets a clear warning.
- The screen stays awake while online (Wake Lock), which reduces the browser background-GPS risk
  (plan R3).
- **Offer screen:** full screen, with the earning in large type, the route as areas only (no phone
  numbers until accepted), distance to pickup, trip distance, a 20-second countdown, and large
  Accept and Decline buttons.
- **Job screen:**
  - map, next stop, contact name and number;
  - Call (`tel:`) and Navigate (Yandex Maps route link);
  - a "collect X ETB by method" reminder when that stop's party pays;
  - one large action button above the tab bar;
  - "receiver not answering" panel: call log and a "mark failed" countdown;
  - release link.
- **Earnings:** today's total and recent jobs.

**Admin** (`/admin/riders`): tabs (applications, approved, suspended, rejected, all), a table with
online status, and actions that require a reason where one is needed.

## Checks

| Check                                                                                     | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck, lint, Prettier                                                                 | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Tests                                                                                     | **137 pass**, 3 skipped (shared 28, API 109). 18 are new: onboarding; admin rules; nearest-eligible dispatch (offline, stale GPS, wrong vehicle and out-of-range riders excluded); no rider available, then a rider comes online; decline and expiry move to the next rider and never back; lapsed offer refused; overlapping dispatches; contacts shared only after accept; double-tap accept; busy rider refused; cancel withdraws the offer; full step sequence; another rider's job refused; cancel after arrival (40 ETB) frees the rider; release goes to another rider; failed-delivery rule, and the rider stays busy while returning |
| Build                                                                                     | pass. Rider surface 6.2 kB gzip, admin 3.9 kB, customer 3.9 kB                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| End to end on the local database (rider in the browser; customer and admin from a script) | Applied, pending, admin approved, went online, booked, offer arrived (106.25 ETB = 125 − 15%), accepted, customer saw rider and plate, four steps to delivered, customer saw all six events, earnings 212.50 for two jobs, admin list correct                                                                                                                                                                                                                                                                                                                                                                                                 |

Fixed during the end-to-end run: the sub-city showed as a slug, so it now shows the English or
Amharic name; the job's action button floated mid-screen; the call-outcome buttons were cut off.

## Not done / limits

- **Real Postgres race test** (`test/concurrency.pg.test.ts`) is written but skipped. It needs
  `TEST_PG_URL` and writes and then deletes rows tagged `+2519009…`. Running it against Neon needs
  your approval. The underlying guarantee (one active delivery per rider) was already shown
  rejecting a second assignment on Neon.
- **Polling, not push:** the rider app polls every 4 s and the customer every 15 s. Socket.IO comes
  in Phase 4c.
- **No payment record yet:** "Delivered" doesn't record cash or Telebirr collection. That's Phase 4d
  (payments and ledger).
- No document upload for rider applications (ID, licence); the admin reviews name, vehicle and plate.
- **Browser GPS:** the location stops when the screen is off. Wake Lock helps; a native wrapper may
  still be needed (plan R3).
- **Neon:** migration `0004` is not applied yet and needs your approval.
