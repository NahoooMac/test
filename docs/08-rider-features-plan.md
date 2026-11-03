# Rider features: integration plan (service areas, home, pool, points, ratings, wallet, route history)

Audit of the repository before the change, and where each feature plugs in. Kept short on purpose.

## What already exists (and stays)

- **Statuses** (`deliveries/state-machine.ts`): requested → assigned → arrived_pickup → picked_up →
  arrived_dropoff → delivered | failed → returning → returned; cancelled from requested / assigned /
  arrived_pickup. A rider "release" (assigned → requested) gives a job back.
- **One active job per rider**: partial unique index `deliveries_one_active_per_rider`.
- **Dispatch** (`dispatch/dispatcher.ts`): offers a requested delivery to one eligible rider at a time
  (20 s offers), nearest first. Eligibility = approved (which now requires approved KYC), online,
  fresh GPS, same vehicle, not busy, not the customer.
- **Money**: fares are paid by sender/receiver straight to the rider (`payments`). The rider owes the
  platform the commission, tracked in the append-only `rider_ledger` (commission +, settlement −,
  adjustment ±), with one commission row per delivery (unique index) and idempotent settlements.
- **Cancellation fees** (0 before arrival, 25/40 ETB after, no commission) and the **failed-delivery
  rule** (3 calls / 10 min → failed → returning → returned, fare still due).
- **KYC** gate (DB check: approved ⇒ KYC approved), audit log, NUMERIC(12,2) money, NUMERIC(9,6)
  coordinates.

Not present in the code (listed in the spec as "must remain"): a 4-digit recipient OTP at pickup,
a mandatory rider emergency contact, and business-account billing. Nothing here removes or adds them.

## Where each feature goes

| Feature | Integration |
|---|---|
| Service areas | `rider_service_areas` (FK to the existing `service_areas` seed of 11 sub-cities). Dispatch, the pool and claims filter on the delivery's pickup sub-city. Pickup sub-city = the geocoder's district stored at booking; when unknown, the nearest sub-city centre (deterministic). Riders with no selection cover all areas, so nobody silently stops receiving work; admin manual assignment is the authorised override. |
| Home location | `riders.home_lat/home_lng/home_radius_km`. A score bonus only; never shown to customers or other riders. |
| Offer pool | Read model over `deliveries` (status `requested`, no open push offer to another rider, eligible for this rider). Claim = one transaction: lock rider, re-check eligibility + wallet, `UPDATE … WHERE status='requested'`, withdraw open offers. The one-active-job index blocks double jobs. Released jobs (assigned → requested) reappear; cancelled/active/finished never do. |
| Points | `rider_points` ledger: initial 50, +1 on delivered, −3 on rider release or an admin cancellation marked rider-responsible, audited admin corrections. Unique indexes make every award/deduction once-only. |
| Ratings | `delivery_ratings` (one per delivered delivery, by its customer). Riders can report a rating; admins keep or remove it (audited). Matching uses a Bayesian average so new riders start neutral. |
| Matching | `dispatch/matching.ts`: explainable score from pickup distance, home proximity, rating, points, reliability and a fairness boost for riders who've waited longest. Weights in `platform_settings`. Score breakdown stored on each offer. Mandatory rules (KYC, vehicle, area, wallet, one job) are filters, never weights. |
| Wallet | The existing `rider_ledger`, read as a prepaid wallet: balance = −SUM(amount). Commission moves from fare recording to the **delivered** transition (same transaction, once per delivery). Top-ups = `settlement` rows, credited only after an admin verifies the Telebirr/CBE Birr reference (`wallet_topups`, unique reference) or receives cash. Eligibility: balance ≥ minimum and balance − this job's commission ≥ −debt limit (default −50 ETB), checked under a row lock at claim/accept/assign. Active jobs are never interrupted. |
| Route history | `delivery_route_points` (delivery, rider, lat/lng, recorded_at, stage, accuracy). The rider app queues fixes offline and uploads batches; the server validates, de-duplicates and assigns the stage from the delivery's own timestamps. Rider and admin history pages draw the actual route, the planned (estimated) route, and replay. |
| Test isolation | Demo data exists only with `--local-db --demo` (separate database). The demo SMS bypass is additionally refused in production. |

## Database

One migration (0009) adds the tables/columns above and backfills 50 starting points for existing
riders. It is applied to the local development database only; Neon needs explicit approval.
