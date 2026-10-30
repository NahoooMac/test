# Phase 4a report — Booking and pricing

Date: 2026-10-31

## Decisions applied as defaults

The owner did not answer the open questions, so these defaults are in place. Each is easy to change.

| Question    | Default                                                                                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1 fare     | `max(minimum, base + per-km × km)`, rounded up to the next 5 ETB. **Placeholder rates:** motorcycle 60 + 18/km, minimum 80; bicycle 40 + 12/km, minimum 50, maximum 8 km. Commission (15% / 10%) and cancellation fees (40 / 25 ETB) follow the approved rules. Rates live in the versioned `pricing_rules` table. |
| Q2 dispatch | Offer to the nearest free rider (Phase 4b)                                                                                                                                                                                                                                                                         |
| Q3 / Q4     | One role per account (Phase 4b)                                                                                                                                                                                                                                                                                    |
| Q5          | `returning` counts as active, so the rider is blocked from new jobs. Enforced by the database index.                                                                                                                                                                                                               |

## Built

**Database** — migrations `0002_deliveries` and `0003_seed_pricing`.

- `riders`: a motorcycle requires a plate number.
- `pricing_rules`: versioned, with one current rule per vehicle type.
- `deliveries`: money is NUMERIC(12,2) and coordinates NUMERIC(9,6). Constraints:
  - **one active delivery per rider** (a partial unique index);
  - commission + rider earning = fare;
  - an active delivery must have a rider;
  - one booking per idempotency key.
- `delivery_events`: an append-only audit trail.

**API**

- `POST /deliveries/quote` — the price for each vehicle. A bicycle beyond 8 km is marked unavailable
  with the reason.
- `POST /deliveries` — requires an `Idempotency-Key` header. The fare is always recomputed on the
  server, and the applied rate and split are stored. Limited to 20 bookings per hour per customer.
- `GET /deliveries`, `GET /deliveries/:id` — the owner only. Another customer's delivery returns 404.
- `POST /deliveries/:id/cancel`:
  - 0 ETB before the rider arrives;
  - 40 / 25 ETB after arrival;
  - refused after pickup;
  - protected by an optimistic lock, and recorded as an event.
- **State machine** (`deliveries/state-machine.ts`): a single table of legal transitions and who may
  make each one. Ready for the rider flows in Phase 4b.
- **Location search** (all requests go through the server, so the keys stay server-side; 60 requests
  per minute per user, with caching):
  - `GET /geo/search` uses **Yandex Geosuggest**, which finds landmarks and businesses;
  - `GET /geo/resolve` gets a suggestion's coordinates from the Geocoder;
  - `GET /geo/reverse` names the spot under a map pin.
  - Offline place list when no keys are set.

**Web (customer)**

- **Home:** a map of Addis, a "Where should it go?" button, and in-progress and recent deliveries.
- **Booking, in four steps:**
  - **Route** — search, my location, or pin on map; plus a map preview with both stops and the route.
  - **Parcel** — description, size, sender (pre-filled from the account) and receiver.
  - **Vehicle** — live quote with fare and ETA; payer; Cash / Telebirr / CBE Birr.
  - **Confirm** — summary, fare and the cancellation policy in plain words.
- **Delivery screen:** map, status, progress bar, rider card (once assigned), details, history, and
  cancel with the fee shown before confirming. Refreshes every 15 s until live updates arrive.
- **Deliveries list** with an empty state.

## Yandex findings (all verified live)

| Product         | Result                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| JS API **v3**   | Rejects all of the project's keys ("Invalid api key")                                                       |
| JS API **v2.1** | Works with the browser key and renders Addis to street level, so the map uses v2.1                          |
| Geocoder        | Good for sub-city, woreda, kebele and streets; does **not** find landmarks by name                          |
| Geosuggest      | Finds Edna Mall, Meskel Square, St George Church and more, with sub-city and kebele, in English and Amharic |

## Checks

| Check                           | Result                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck, lint, Prettier       | pass                                                                                                                                                                                  |
| Tests                           | **119 pass** (shared 28, API 91). 31 are new: pricing maths, the state machine, sub-city matching, booking API, database rules, Yandex adapter                                        |
| Build                           | pass. The customer surface is 11 kB gzipped; the core bundle is 148 kB                                                                                                                |
| Browser, 375 px, local database | Full booking: Edna Mall searched → pin dragged → St George Church → parcel (validation shown) → 9.4 km, 230 ETB motorcycle, bicycle blocked at 8 km → booked #3FKGS5 → cancelled free |

Fixed during browser verification:

- The map container could collapse to 0 px. `MapView` now owns its positioning.
- The stepper truncated the active step's label.
- The location buttons overflowed.
- Page content covered the Yandex logo and Terms link.
- Geocoder-only search missed landmarks, so search switched to Geosuggest.
- Phone numbers on the confirm screen are now formatted.

## Not done / limits

- **Distance is an estimate** (straight line × 1.3, and labelled as an estimate). There is no Yandex
  routing key. Exact road distance needs the Yandex Router or Distance Matrix API.
- **No rider can be assigned yet.** Bookings stay at "Finding a rider" until Phase 4b (dispatch and
  rider app).
- The map is v2.1. Moving to v3 later needs a v3-enabled key.
- **Production database:** migrations 0002 and 0003 are **not applied** to Neon. That waits for your
  approval. Local testing used `npm run dev:local` (the embedded database).
- Amharic copy is still a draft.
