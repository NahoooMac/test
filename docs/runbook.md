# Operations runbook

Day-to-day tasks and what to do when something goes wrong. Admin screens are under `/admin`.
Every admin action below is written to the audit log, with the admin, time and reason.

## Accounts

**Make someone an admin.** Run on the server, with its environment loaded. Against a remote
database the command refuses to run unless you confirm it for that one run:

```bash
ALLOW_REMOTE_ADMIN_GRANT=true npm run admin:grant -- 0911234567
```

The number can be typed with 0, 251 or +251. The person signs in at `/admin` with an SMS code.
Admin sessions last 12 hours. There is no screen for removing admin rights yet. Suspend the account
instead (below), or change `users.role` in the database.

**Approve a rider.** Open _Riders_ → _Applications_. Check the name, vehicle and plate, then
approve, or reject with a reason. An approved rider can later be suspended (which takes them
offline at once) and reinstated.

**Suspend or reinstate a user.** Open _Users_ → search by phone or name → _Suspend_, with a
required reason. This signs the user out of every device and closes their live connections. A
suspended rider goes offline and gets no offers. An active job stays assigned, so reassign it
first (below). Admins can't suspend themselves.

## Deliveries

**A delivery is stuck on "Finding a rider".** The dispatcher offers each job to the nearest free,
online rider with the matching vehicle within 7 km, for 20 seconds each, one rider at a time. It
stops when no rider is left who hasn't been asked. Open _Deliveries_ → the delivery:

- **Assign rider** picks a specific free rider with the right vehicle. A busy rider is refused.
- **Re-offer to all riders** starts a new round. Riders who passed or let it lapse are asked
  again.
- If no rider is coming, **cancel** with a reason and tell the customer.

_Live operations_ shows how many riders are online and free right now, per vehicle.

**A rider vanished mid-delivery.** Call the rider first; both phone numbers are on the delivery
page. If they can't continue, cancel the delivery with a reason, then book again or reassign. A
rider can only ever hold one active job, so a stuck job blocks that rider until it's resolved.

**A receiver can't be reached.** The rider logs at least 3 calls over at least 10 minutes. After
that the app lets them mark the delivery failed and bring the parcel back (FAILED → RETURNED).
The fare is still due and there is no return fee. On the way back the rider's screen asks for the
payment, which the sender settles when the parcel is returned. If it isn't recorded then, there
is no screen to record it later yet; note the delivery code for a developer.

**Cancellation after the rider arrived** creates a cancellation fee: 25 ETB for a bicycle, 40 ETB
for a motorcycle, all of it the rider's, with no commission. It shows as _due_ on the delivery.
When it's paid, open the delivery → _Payments_ → mark it collected with the method, or waive it
with a reason.

## Money

Customers pay riders directly (cash, Telebirr, CBE Birr). Each recorded fare adds the platform's
commission to what that rider owes: 15% for motorcycles, 10% for bicycles.

**Record a settlement.** Open _Reconciliation_ → the rider → _Record settlement_: amount, method
and reference (for example the Telebirr transaction ID). A settlement can't exceed what the rider
owes. Submitting the same form twice records it once.

**End-of-day check.** _Reconciliation_ shows fares collected, commission owed, settled and
outstanding, in total and per rider. _Export CSV_ downloads the same table for accounting.

**Change fares or commission.** Open _Pricing_ → the vehicle → edit → save. The new rule applies to
bookings from that moment. Deliveries already booked keep their price. The old rule stays in the
history. Commission above 50% is refused.

**A wrong payment or settlement.** Entries are never edited or deleted. A correction would be an
adjustment entry, which has no screen yet; until then it needs a developer. Note the delivery
code and the right amount.

## Sign-in and SMS

**"We can't send codes right now".** The daily SMS budget (`SMS_DAILY_BUDGET`, counted per UTC day)
has run out. Everyone already signed in keeps working; sessions last 30 days. To raise it, check
the AfroMessage balance, raise the variable and restart the app. The log line is
`daily SMS budget exhausted`.

**One person can't get a code.** The limits are 3 codes per 15 minutes and 6 per day per number,
plus 10 per hour per network address. Five wrong codes lock the number for 15 minutes. These reset
on their own. Check that the number is a valid Ethiopian mobile number (09… or 07…).

**Check AfroMessage** (sends nothing): `npm run sms:check -w @dp/api` prints the balance and
roughly how many SMS it covers, or the exact problem. To also send one test SMS and follow its
delivery status: `npm run sms:check -w @dp/api -- --send 0911234567`. Use only a number whose owner
agreed to it.

**Codes never arrive for anyone.** Look in the server log for `OTP SMS failed`. Its `code` field
is AfroMessage's error code, e.g. `AFRO_401-9` = account balance too low, so top up in the
AfroMessage dashboard. Each send is
recorded in the `sms_messages` table with its status and the provider's message ID, never the code
itself. Check the AfroMessage dashboard for balance and sender approval.

## Server

**Restart.** Restarting is safe at any time. Live connections reconnect within a few seconds, and
open offers and timers live in the database.

**Health.** `GET /api/health` says whether the process is up. `GET /api/health/ready` returns
503 if the database is unreachable.

**Deploy a new version.** Build, apply any new migration (with approval, see
[deploy.md](deploy.md)), then restart.

## Local development

- **Reset local data:** stop the dev server and delete `apps/api/.data/pglite`. The next
  `npm run dev:local` recreates it with all migrations and the seed fares.
- `npm run dev` uses the Neon database from `apps/api/.env`. Use `npm run dev:local` for test
  data.
- Codes are printed in the dev server's terminal (`SMS_PROVIDER=console`).
