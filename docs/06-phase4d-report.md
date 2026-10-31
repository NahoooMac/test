# Phase 4d report — Payments, ledger and admin tools

Date: 2026-10-31

## Built

**Database** — migration `0005_payments`:

- `payments`, one row per delivery and type (`fare`, `cancellation_fee`), with status due, collected
  or waived. A collected payment must have a method and a time.
- `rider_ledger`, append-only. Commission is a positive entry, written **once per delivery** and
  enforced by a partial unique index. Settlements are negative entries with an idempotency key.
  The balance is the sum of the entries.
- `admin_audit_log` for every admin action.
- **Dispatch rounds:** `deliveries.dispatch_round` and `delivery_offers.round`. The "asked once"
  index becomes "asked once **per round**", so an admin re-offer can reach riders who passed before.
  This drops one index and creates its replacement; no data is touched.

**Payments (riders are paid directly)**

- `POST /rider/jobs/:id/payment` (method plus an optional transaction reference):
  - **Sender pays:** can be recorded from arrival at pickup onwards. **Receiver pays:** from pickup
    onwards, normally at the drop-off.
  - Can also be recorded after a failed delivery is returned, since the fare stays due.
  - Records the fare and the rider's commission in one transaction. Recording again returns the
    original; concurrent taps were tested.
- **"Delivered" is refused until the fare is recorded** (`PAYMENT_REQUIRED`), so every completed
  delivery says how it was paid.
- **Cancellation after the rider arrived:** a `cancellation_fee` payment is created as **due**, with
  **no commission** (the whole fee goes to the rider). An admin marks it collected (with a method)
  or waived.
- `GET /rider/ledger`: what the rider owes, plus their history.

**Admin**

- **Deliveries:** a list with search by code, name or phone (typed with 0 or 251) and a status
  filter. Each delivery's page shows people, money, payments, status history, offers by round,
  calls to the receiver, and admin actions. From there an admin can:
  - **assign a rider manually** (approved, free, matching vehicle; a busy rider is refused by the
    database);
  - **re-offer to all riders** (starts a new round);
  - **cancel**, with a required reason and an optional fee once the rider has arrived;
  - **resolve a due payment**.
- **Reconciliation:**
  - totals: fares collected by riders, commission owed, settled, outstanding;
  - a row per rider; opening one shows their ledger;
  - **record a settlement**: idempotent by key, cannot exceed what's owed (the rider row is locked
    during the check), with method and reference;
  - **CSV export**, with formula-injection protection.
- **Pricing:** current rates per vehicle, with an edit form and history. Saving closes the current
  rule and creates a new one, which applies to new bookings immediately; past deliveries keep their
  rule. Commission above 50% is rejected.
- **Users:** search, and suspend or reinstate with a required reason. Suspending revokes every
  session, closes live streams, and takes a rider offline. Admins can't suspend themselves.
- **Audit log:** assignments, re-offers, cancellations, payment resolutions, settlements, pricing
  changes, user status changes and rider approval decisions.

**Customer:** the delivery screen shows "Paid to the rider · Telebirr" once the fare is recorded.

## Checks

| Check                            | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck, lint, Prettier        | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Tests                            | **155 pass**, 3 opt-in skipped (shared 28, API 127). 11 are new: fare recorded once under concurrent taps with commission once; receiver fare blocked at pickup; fare recordable after return; cancellation fee due with no commission, and the resolve rules; settlements (missing key, over-settlement, idempotent repeat, balance, reconciliation totals, CSV, audit, admin-only); pricing versioning (old delivery keeps its rule; commission cap); manual assign (wrong vehicle, busy rider, history and audit); re-offer reaches a rider who let it lapse; admin cancel with and without fee; search; user suspension revokes sessions and blocks self-suspension |
| Build                            | pass. Admin surface 10.8 kB gzip, rider 6.7 kB, customer 4.1 kB, tracking 1.8 kB                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| End to end on the local database | **Rider:** at drop-off "Delivered" was disabled until payment; recorded Telebirr with a reference; "Paid · Telebirr"; delivered; earnings show **18.75 ETB owed** (15% of 125). **Admin:** stuck #76EV6V assigned manually (history "admin · Assigned manually", audit written), then cancelled with a reason; reconciliation showed 125 collected, 18.75 owed; a 20 ETB settlement was refused ("owes 18.75"); a 10 ETB Telebirr settlement left 8.75; ledger and CSV correct; pricing and users pages correct                                                                                                                                                         |

Fixed during verification: phone numbers in the CSV export now drop the leading "+", which the
formula-injection protection had turned into a stray quote.

## Not done / limits

- **Fare recorded after a return:** the API supports it, but returned jobs leave the rider's active
  screen, so in practice an admin records it.
- **No real payment gateway:** Telebirr and CBE Birr are recorded by method and reference only, as
  specified. Automated integration needs official merchant access.
- **Admin UI is English only;** the customer and rider apps are English and Amharic.
- **Ledger adjustments:** the schema supports them, but there's no admin screen yet. Settlements
  cover the normal case.
- **Neon:** migration `0005` is not applied yet and needs your approval.
