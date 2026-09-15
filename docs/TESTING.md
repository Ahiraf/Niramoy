# Testing

```bash
npm test                  # unit + integration (in-process PostgreSQL)
npm run test:concurrency  # needs a real server — docker compose up -d
npm run verify            # lint + typecheck + test + build
```

## Counts

| Suite | Tests | What it covers |
|---|---|---|
| `lib/db/__tests__/constraints` | 21 | Schema guarantees, with no application code in the way |
| `lib/scheduling/__tests__/engine` | 33 | The pure engine: boundaries, buffers, exceptions, timezones |
| `lib/ai/__tests__/triage` | 55 | Vignettes, validation, injection, the urgency floor |
| `test/__tests__/security` | 46 | Every case in brief §61, CSRF, plus video authorization |
| `test/__tests__/jobs` | 11 | Idempotency of every scheduled job |
| `test/__tests__/ai-workflow` | 14 | Persistence, provenance, the summary approval path |
| `test/__tests__/payments` | 21 | Webhook verification, idempotency, amount integrity, the bKash flow |
| `test/__tests__/payment-retry` | 11 | Resuming a live payment, retrying a spent one, the browser return |
| `test/__tests__/availability` | 16 | One-time hours, blocks, validation, one doctor's schedule vs another's |
| `test/__tests__/video-demo-mode` | 7 | What DEMO_MODE relaxes, and everything it does not |
| **`npm test` total** | **357** | |
| `test/__tests__/booking.concurrency` | 6 | **Requires a real server** |

Which requirement each of these proves is mapped in
[TRACEABILITY.md](TRACEABILITY.md), along with the requirements that nothing
proves.

## Manual demonstration steps

Automated tests cannot reach a third party's hosted page, and the SSLCommerz IPN
cannot reach `localhost` at all. These are the steps that close that gap. Run
them **on the deployed HTTPS URL** — a payment flow that works locally proves
very little, because locally the settlement callback never arrives.

### bKash sandbox payment

1. Sign in as a patient. Book a consultation and choose **bKash**.
2. The checkout sheet says "Continue on bKash", names the amount, and carries
   the sandbox banner. Press **Continue to bKash**.
3. The address bar should now read `sandbox.sslcommerz.com`. That is the point
   of the plain link — the payer sees the gateway's own domain.
4. Complete the sandbox payment with a test wallet.
5. You land back on Niramoy with a toast, and the appointment shows **Paid with
   bKash**. If it still says payment due, the IPN URL is not registered in the
   merchant panel — see the deployment checklist.

### Payment failure and cancellation

1. Start a payment and press **Cancel** on the SSLCommerz page.
2. You return to Niramoy with "payment cancelled, your appointment is still
   booked", and the appointment is still **Confirmed**. Nothing was charged and
   nothing was lost.
3. Press **Pay with bKash** again: a working gateway page opens. This is the
   retry path, and it is the one that used to be dead.
4. Refresh the page after returning. The outcome is announced once, not twice,
   and no second appointment or payment appears.

### A doctor creating availability

1. Sign in as a verified doctor → **Availability**.
2. **Add hours** creates a recurring weekly rule. The table shows the hours in
   Bangladesh time next to what is stored in UTC — the two should differ by the
   zone offset, which is the visible proof that nothing is stored as local time.
3. **Add a date** → *Extra consulting hours* on a future date, ideally a weekday
   you do not normally work. It appears under **Specific dates**.
4. Add another on the same date overlapping the first: refused.
5. Try a date in the past: refused.
6. **Add a date** → *Block part of the day* over an hour you do work.

### A patient booking a slot

1. As a patient, open that doctor and press **See available times**.
2. The one-off date appears in the day strip with its own slots, at the times
   the doctor entered — even though there is no weekly rule for that day.
3. The blocked hour is absent from its day; the rest of that day is still there.
4. Book one. Booking the same time again from a second account is refused by
   the database, not by the page.

### The doctor and the patient in one consultation

1. With `DEMO_MODE=true`, the room opens regardless of the appointment time.
2. As the patient: **Join call** (in the More actions menu when a payment is
   still outstanding).
3. As the doctor, in a different browser or profile: **Open room**.
4. Both see the same room, and the status line reads `demo mode`. Grant camera
   and microphone when the browser asks — this only works over HTTPS, which is
   why it is a deployed test rather than a local one.
5. Turn `DEMO_MODE` off and try again outside the appointment window: the room
   refuses to open. That refusal is the thing being demonstrated.

### Instructor demo mode

Set on the deployment: `DEMO_MODE=true`, `VIDEO_PROVIDER=jitsi`,
`ALLOW_PUBLIC_VIDEO_ROOM=true`, both `SSLCOMMERZ_*` credentials, and
`ALLOW_DEMO_PROFILES=true`. Then `GET /api/admin/diagnostics` as an admin should
list exactly three warnings — the public video room, demo mode, and the demo
directory — and no others.

## Why integration tests use a real database

PGlite is PostgreSQL compiled to WASM, so CHECK constraints, triggers and
`btree_gist` behave exactly as they do on a server. Tests run the real route
handlers with real `Request` objects against it.

Nothing is mocked. The properties under test — "is this query scoped to the
session?" — live in the SQL and the authorization helpers. A test that mocked
the repository would be asserting about the mock.

## Why concurrency tests need a real server

PGlite is single-connection: it serialises everything, so it would pass the
concurrency suite without proving anything. A test that cannot fail is worse
than no test, so the suite **skips loudly** with an explanatory message rather
than pretending.

That suite is what found the deadlock: twelve simultaneous overlapping inserts
deadlocked persistently, and four retries did not clear it. The fix was a
per-doctor advisory lock. Running against the in-process database, this would
never have been discovered.

## What testing found

Each of these was a real defect, caught by writing the test rather than by
reading the code:

1. **Persistent deadlock** under concurrent overlapping inserts — led to the
   advisory lock.
2. **Two red-flag coverage gaps** — "face **is** drooping" and "throat **is**
   closing" did not match patterns written without the intervening word.
3. **Drizzle wraps driver errors**, so SQLSTATE and constraint names are on
   `cause`. Reading the top-level message turned an expected 409 into a 500.
4. **A partial test fixture** seeded two specialties, so triage routing to a
   third silently lost provenance rows.

## What testing missed, and why

One defect reached a human tester rather than a test, and it is more instructive
than the four above.

**"Confirm appointment" failed for every user with a valid session.** The CSRF
origin check compared `Origin` against the configured `APP_URL`, which defaults
to `http://localhost:3000`. Served on any other port or host — a second
`next dev` on :3001, a phone on the LAN address, a preview deployment — every
state-changing request was rejected. Reads and sign-in still worked, because
CSRF is only enforced once a session exists, so the first thing to fail was the
first thing a user POSTs.

The suite had 44 security tests and none of them caught it. The reason is worth
stating plainly: **every test constructed `new Request("http://localhost:3000/…")`
with no `Host` header**, so the check always compared against the one origin that
happened to match. The tests were not wrong about the logic. The environment
they ran in was unrepresentative in exactly the dimension the bug lived in.

Two lessons, both now applied:

- *A test environment is a set of assumptions, and untested assumptions are
  where bugs hide.* The regression tests added with the fix
  (`security` › accepts a request served on a different host than APP_URL, and
  its foreign-origin twin) set `Host` explicitly, so the dimension is now
  varied rather than fixed.
- *API-level tests cannot catch a defect whose symptom is "the button does
  nothing".* This is the strongest argument in the project for writing the
  Playwright specs listed under **Not implemented** below.

## Not implemented

**End-to-end browser tests.** `npm run test:e2e` is wired for Playwright and
`docs/IMPLEMENTATION_PLAN.md` names the two journeys, but no specs are written.
The journeys are exercised at the API level instead, which covers the logic and
not the rendering. This is an honest gap, not a claim.

**Load testing.** Scaling assumptions in `SCALING.md` are reasoned, not measured.
