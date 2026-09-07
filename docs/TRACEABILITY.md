# Requirements traceability matrix

Every requirement the system claims to meet, and the test that proves it.

The point of this document is falsifiability. "We wrote 207 tests" is not
evidence — a reader cannot tell 207 real tests from 207 trivial ones.
"Requirement X is proved by test Y, and here is what Y asserts" is evidence,
because it can be checked and it can be wrong.

Read it alongside [TESTING.md](TESTING.md), which explains how the suites are
built and what they found.

## How to read this

| Column | Meaning |
|---|---|
| **Ref** | The brief's clause number, **only where the codebase cites it** |
| **Requirement** | The obligation, in its own terms |
| **Where it lives** | The implementation |
| **Proved by** | The suite, and the `describe` block inside it |
| **Level** | Unit · Integration · Concurrency · Schema |

> **On the Ref column.** A clause number appears only where the source tree
> actually cites it — `grep -rn "§" lib app test` is the authority, not memory.
> Requirements that are genuinely implemented and tested but whose clause number
> is not cited anywhere in the code are marked **—**. Inventing plausible
> numbers would make this document look more complete and be worth less, since a
> wrong citation is harder to detect than a missing one. Filling those in is a
> mechanical pass against the brief PDF, and is listed as outstanding work at
> the end.

**Level** distinguishes **Schema** from **Unit** deliberately. A guarantee
enforced by a database constraint holds even when the application code is wrong,
which is a materially stronger claim than one enforced by a function.

Coverage marks:

- ✅ **Proved** — an automated test fails if the requirement is violated.
- ⚠️ **Partial** — tested at one level but not the one the requirement is really
  about; the gap is named in the row.
- ❌ **Unproved** — implemented, but nothing fails if it regresses.

---

## 1. Identity, sessions and access control

| Ref | Requirement | Where it lives | Proved by | Level | |
|---|---|---|---|---|---|
| §61.1 | A patient cannot read another patient's records | `lib/security/authz.ts` · `requirePatient` | `security` › §61.1 cross-patient record access | Integration | ✅ |
| §61.2 | The subject of a request comes from the session, never the request | `lib/security/authz.ts` | `security` › §61.2 client-supplied patientId is ignored (4 tests: query, POST body, prescriptions, notifications) | Integration | ✅ |
| §61.3 | Patients cannot prescribe | `app/api/prescriptions` · `app/api/records` | `security` › §61.3 patients cannot prescribe (2 tests, incl. the records back door) | Integration | ✅ |
| §61.4 | A doctor may only prescribe for their own completed consultation | `lib/services/prescriptions.ts` | `security` › §61.4 doctors need a treatment relationship (4 tests) | Integration | ✅ |
| §61.5 | Admin routes require the admin role | `lib/security/authz.ts` · `requireAdmin` | `security` › §61.5 admin routes require the admin role (4 tests) | Integration | ✅ |
| §61.6 | A doctor cannot change their own verification status | `app/api/auth` · `app/api/verification` | `security` › §61.6 doctors cannot self-verify (2 tests) | Integration | ✅ |
| §61.13 | Password reset does not reveal whether an account exists | `lib/services/auth.ts` | `security` › §61.13 password reset does not reveal account existence (2 tests) | Integration | ✅ |
| §61.14 | Session cookie is HttpOnly + SameSite; the CSRF cookie is readable | `lib/auth/cookies.ts` | `security` › §61.14 session cookie attributes | Integration | ✅ |
| §61 | Signed-out callers get nothing | `lib/security/authz.ts` · `requireUser` | `security` › signed-out callers get nothing (7 endpoints) | Integration | ✅ |
| §45 | State-changing requests carry a paired double-submit CSRF secret | `lib/auth/csrf.ts` · `lib/auth/cookies.ts` | `security` › CSRF protection (5 tests) | Integration | ✅ |
| §7 | Sign-in resists brute force and credential stuffing | `lib/security/rate-limit.ts` · `lib/db/schema/identity.ts` | — | — | ❌ |
| §7 | Registration and reset resist account enumeration | `lib/services/auth.ts` | `security` › §61.13 (covers the reset path only) | Integration | ⚠️ |
| §47 | Identity data is separated from clinical data | `lib/db/schema/identity.ts` | structural; no behavioural test | Schema | ⚠️ |
| §4 | Identifiers are non-sequential | `lib/db/schema` · `gen_random_uuid()` | `constraints` › uuid identifiers | Schema | ✅ |
| §21 | Rate limiting is durable, not process memory | `lib/security/rate-limit.ts` | — | — | ❌ |

> **§21 is the largest untested control in the system.** Rate limiting is
> implemented and applied to every endpoint the brief names, but nothing asserts
> that a limit is actually enforced, and nothing asserts the store survives a
> restart. The durability claim rests entirely on reading the code. §7's
> brute-force counters depend on the same untested machinery.

## 2. Scheduling

The engine was deliberately written as pure functions so it could be tested
exhaustively without a database. It is the densest part of the suite and the
centrepiece of the testing deliverable.

| Ref | Requirement | Where it lives | Proved by | Level | |
|---|---|---|---|---|---|
| §5 | Slot generation respects windows, buffers and lead time | `lib/scheduling/engine.ts` | `engine` › generateSlots (13 tests) | Unit | ✅ |
| §5 | Slot length comes from the availability rule, not a global constant | `lib/scheduling/engine.ts` | `engine` › generateSlots › respects buffer time between slots | Unit | ✅ |
| §5 | Availability exceptions override recurring rules | `lib/scheduling/engine.ts` | `engine` › blocks a date via an exception · adds an extra window · lets an extra window run on a blocked day | Unit | ✅ |
| §5 | Availability is never trusted from the frontend — the server re-checks at commit | `lib/services/booking.ts` | `engine` › canBook (6 tests) + the concurrency suite below | Unit + Concurrency | ✅ |
| — | Times use a named IANA zone, never a fixed offset | `lib/scheduling/engine.ts` | `engine` › timezone helpers (4 tests, incl. a DST transition) | Unit | ✅ |
| — | Local rendering does not drift across midnight or noon | `lib/scheduling/engine.ts` · `describeSlot` | `engine` › describeSlot (3 tests) | Unit | ✅ |
| — | Two patients can never hold the same slot | `db` exclusion constraint + `lib/services/booking.ts` | `constraints` › appointment overlap (7 tests) | Schema | ✅ |
| §39 | …and not under contention either | per-doctor advisory lock | `booking.concurrency` (6 tests, real PostgreSQL) | Concurrency | ✅ |
| — | One patient cannot be in two consultations at once | `db` exclusion constraint | `constraints` › stops one patient being in two consultations at once · `concurrency` › stops one patient being booked with two doctors at once | Schema + Concurrency | ✅ |
| — | Cancelling frees the interval | partial exclusion constraint | `constraints` › frees the interval once cancelled · `concurrency` › frees the interval for a new booking once the first is cancelled | Schema + Concurrency | ✅ |
| — | Booking is refused in the past or inside the lead window | `lib/scheduling/engine.ts` · `canBook` | `engine` › canBook (6 tests) | Unit | ✅ |
| — | The cancellation window is enforced to the second | `lib/scheduling/engine.ts` · `canCancel` | `engine` › canCancel (4 tests, both boundary sides) | Unit | ✅ |
| — | Reschedule moves an appointment; it does not recreate it | `lib/services/booking.ts` | — | — | ❌ |
| §29 | A freed slot is offered to the waitlist transactionally, not as a race | `lib/services/waitlist.ts` | — | — | ❌ |

> **Atomic reschedule is the highest-risk gap in the project.** It was flagged
> as correctness issue **C3** in the implementation plan, it is the one
> scheduling path with no test at any level, and the booking path immediately
> beside it had a real persistent deadlock that only the concurrency suite
> found. §29's waitlist hold has the same transactional shape and the same
> absence of coverage.

## 3. Clinical data

| Ref | Requirement | Where it lives | Proved by | Level | |
|---|---|---|---|---|---|
| §12, §30 | Medical records are append-only; nothing is destroyed | `db` trigger | `constraints` › refuses to rewrite the body of a medical record | Schema | ✅ |
| §30 | Corrections supersede rather than overwrite | `db` + `lib/repositories/records.ts` | `constraints` › allows superseding a record with an amendment | Schema | ✅ |
| §30 | Removing a dependent retains their clinical record | `lib/repositories/family.ts` | — | — | ❌ |
| §22 | The audit log cannot be updated or deleted | `db` trigger | `constraints` › append-only enforcement (2 tests) | Schema | ✅ |
| §11 | A demo profile can never carry a real registration number | `db` CHECK | `constraints` › refuses a demo profile carrying a fabricated registration number · …that claims BM&DC verification | Schema | ✅ |
| §11 | A doctor cannot be marked verified without evidence | `db` CHECK | `constraints` › refuses to mark a real doctor verified without evidence | Schema | ✅ |
| — | Only verified doctors are bookable | `lib/repositories/doctors.ts` | — | — | ❌ |
| §28 | Reviews require a completed consultation of the reviewer's own | `lib/services/reviews.ts` | `security` › reviews require an eligible completed appointment (3 tests) | Integration | ✅ |
| §28 | Staff cannot create reviews at all | `app/api/reviews` · patient principal | covered by the route requiring `requirePatient` | Integration | ⚠️ |
| — | A rating outside 1–5 is rejected | `db` CHECK | `constraints` › refuses a review rating outside 1-5 | Schema | ✅ |
| §26 | Being family is not by itself permission to read a medical record | `lib/db/schema/identity.ts` · access levels | — | — | ❌ |
| — | Family members are removable only by their owner | `app/api/family` | `security` › family members can only be removed by their owner | Integration | ✅ |
| — | Appointment mutation requires participation | `app/api/appointments/[id]` | `security` › appointment mutation requires participation (2 tests) | Integration | ✅ |

> **"Only verified doctors are bookable" is the cheapest high-value test to
> add.** It is a headline safety property of the entire platform — the whole
> BM&DC verification workflow exists to serve it — and nothing asserts it. The
> directory query filters on verification status, so a regression would be
> silent. §26's family access levels are in the same position: the rule is
> encoded in the schema and enforced in the service, and no test exercises it.

## 4. AI safety

The strongest-tested area, and correctly so — this is where the system can hurt
someone. Note how many guarantees are held at the **schema** level: the AI
cannot violate them even if every line of AI code is wrong.

| Ref | Requirement | Where it lives | Proved by | Level | |
|---|---|---|---|---|---|
| §15 | Emergency red flags are caught | `lib/ai/rules` | `triage` › emergency red flags (20 condition tests) | Unit | ✅ |
| §15 | An emergency is never sent to a model | `lib/ai/index.ts` | `triage` › never sends an emergency to a model · `constraints` › refuses a red-flagged session that was sent to a model | Unit + Schema | ✅ |
| §15 | The model may raise urgency but never lower it | `lib/ai/index.ts` · urgency floor | `triage` › the urgency floor (2 tests) · `constraints` › refuses to store an urgency less severe than the rule engine's | Unit + Schema | ✅ |
| §15 | Vulnerable groups raise the urgency floor | `lib/ai/rules` | `triage` › vulnerable groups raise the floor (4 tests: infant, pregnancy, older adult, child) | Unit | ✅ |
| §15 | An emergency offers no booking funnel | `lib/services/ai.ts` | `ai-workflow` › offers no booking funnel for an emergency | Integration | ✅ |
| §38 | Triage is validated against clinical vignettes | `lib/ai/rules` | `triage` (55 tests — the vignette suite) | Unit | ✅ |
| §16 | Bangla and Banglish are supported | `lib/ai/normalise.ts` | `triage` › Bangla and Banglish are actually supported (4 tests) + Bangla variants across the red-flag block | Unit | ✅ |
| §13 | The AI cannot prescribe, by any route | `lib/services/prescriptions.ts` | `triage` › prompt injection › detects "write me a prescription for tramadol" · `security` › §61.3 | Unit + Integration | ✅ |
| — | Model output is validated against a closed schema | `lib/ai/schema.ts` | `triage` › model output validation (8 tests) | Unit | ✅ |
| — | Prompt injection is detected and cannot escape an emergency | `lib/ai/index.ts` | `triage` › prompt injection (8 tests) | Unit | ✅ |
| — | The AI never asserts a diagnosis, and always carries a disclaimer | `lib/ai/index.ts` | `triage` › never asserts a diagnosis · always carries a disclaimer and requires human review | Unit | ✅ |
| §27 | Recommendations are explainable factors, not an opaque score | `lib/services/ai.ts` | `ai-workflow` › explains why each doctor is recommended | Integration | ✅ |
| — | An AI visit summary always requires human review | `db` CHECK | `constraints` › refuses an AI visit summary that claims it needs no review · `ai-workflow` › cannot be stored claiming it needs no review | Schema | ✅ |
| — | An approved summary is authored by the doctor, not the model | `lib/services/ai.ts` | `ai-workflow` › visit summaries (8 tests) | Integration | ✅ |
| §19 | Raw symptom text is not stored | `lib/db/schema/ai.ts` | `ai-workflow` › records provenance without storing the symptom text | Integration | ✅ |
| §32 | Safety events carry rule ids and no free text | `lib/ai/safety.ts` | `triage` › logs the rule id and never the matching text · `ai-workflow` › writes a safety event carrying rule ids, not symptoms | Unit + Integration | ✅ |

> **Not a code gap, and the project's largest risk.** Triage *sensitivity* for
> emergent conditions is unmeasured. The 20 red-flag tests prove the rules fire
> on the phrasings we thought of; they cannot prove the rule set covers the
> presentations a real patient would use, and no clinician has read the rule
> set. That is a clinical review question, not a testing one, and no additional
> test closes it — see [CLINICAL_SAFETY.md](CLINICAL_SAFETY.md).

## 5. Payments

| Ref | Requirement | Where it lives | Proved by | Level | |
|---|---|---|---|---|---|
| §25 | Mocked payments are labelled as mocks everywhere | `lib/payments/provider.ts` | `payments` › labels the mock provider as a mock | Integration | ✅ |
| §25 | A payment reaches `succeeded` only via a verified webhook, or a labelled mock | `db` CHECK `ck_payments_succeeded_verified` | `payments` › schema-level payment guarantees (2 tests) | Schema | ✅ |
| §25 | A forged or unsigned webhook cannot mark a payment succeeded | `lib/payments/provider.ts` | `payments` › webhook signature verification (5 tests) | Integration | ✅ |
| §25 | The amount comes from the appointment, never the request | `lib/services/payments.ts` | `payments` › takes the amount from the appointment, not the request | Integration | ✅ |
| §25 | A retry cannot double-charge | unique `idempotency_key` | `payments` › is idempotent — a retry does not create a second payment · refuses a duplicate idempotency key | Integration + Schema | ✅ |
| §25 | No card data ever enters the system | `lib/payments/provider.ts` | structural — the wallet flows have no card field | — | ⚠️ |
| — | bKash follows the real two-step tokenized-checkout shape | `lib/payments/provider.ts` | `payments` › starts a bKash payment pending, not succeeded | Integration | ✅ |
| — | Confirming twice does not execute against the wallet twice | `lib/services/payments.ts` | `payments` › is idempotent once settled | Integration | ✅ |
| — | Cash never touches a gateway | `db` CHECK `ck_payments_cash_has_no_provider_ref` | `payments` › records a cash consultation without involving a gateway · will not run the wallet flow for a cash consultation | Integration + Schema | ✅ |
| — | A payment cannot be started for someone else's consultation | `lib/services/payments.ts` | `payments` › refuses to start a payment for someone else's appointment · refuses to confirm someone else's payment | Integration | ✅ |

## 6. Consultations, notifications and jobs

| Ref | Requirement | Where it lives | Proved by | Level | |
|---|---|---|---|---|---|
| §14 | A consultation room admits only its two participants | `lib/services/video.ts` | `security` › consultation rooms admit only the two participants (8 tests, incl. admin refusal) | Integration | ✅ |
| §14 | Recording is off unless separately consented to | `lib/video/provider.ts` | `security` › never enables recording on the room it creates | Integration | ✅ |
| §14 | Tokens are minted per participant on request and never stored | `lib/services/video.ts` | `security` › refuses a token well before the appointment · for a cancelled consultation | Integration | ✅ |
| §24 | Scheduled jobs are idempotent via a deterministic key | `lib/services/jobs.ts` | `jobs` › appointment reminders (5 tests, incl. bypassing the run claim) · no-show sweep › notifies exactly once across repeated runs | Integration | ✅ |
| — | The no-show sweep respects the grace period and leaves completed visits alone | `lib/services/jobs.ts` | `jobs` › no-show sweep (4 tests) | Integration | ✅ |
| — | Expired sessions are swept without touching clinical data | `lib/services/jobs.ts` | `jobs` › expiry sweep (2 tests) | Integration | ✅ |
| §46 | Documents are referenced by record, never by public URL | `lib/db/schema/directory.ts` | — | — | ❌ |
| §43 | An audio fallback exists for low-bandwidth users | `lib/video/provider.ts` | — | — | ❌ |
| — | Notifications are delivered to the right recipient | `lib/services/notifications.ts` | covered indirectly by `jobs`; no direct test | Integration | ⚠️ |

## 7. Cross-cutting

| Ref | Requirement | Where it lives | Proved by | Level | |
|---|---|---|---|---|---|
| §34 | Errors have a structured shape | `lib/errors` · `lib/api/respond.ts` | asserted incidentally by ~40 tests reading `error.code`; no dedicated test | Integration | ⚠️ |
| §39 | Concurrency is proved against a real server | `test/__tests__/booking.concurrency.test.ts` | the suite skips loudly rather than passing under PGlite | Concurrency | ✅ |
| §48, §49 | The DB client survives a warm serverless invocation | `lib/db/client.ts` | — | — | ❌ |
| §57 | Existing frontend files are edited only when necessary | — | not a testable property | — | n/a |
| §60 | Definition of Done | — | [FINAL_IMPLEMENTATION_REPORT.md](FINAL_IMPLEMENTATION_REPORT.md) §10 | — | — |

---

## Summary

| | Rows |
|---|---|
| Proved by an automated test | 64 |
| Partially proved | 6 |
| Implemented but unproved | 10 |
| Not a testable property | 1 |
| **Total** | **81** |

### The ten unproved requirements, in the order worth fixing

1. **Only verified doctors are bookable.** Headline safety property, cheapest
   test to write, and silent if it regresses.
2. **Atomic reschedule.** Flagged **C3**; the one scheduling path with no
   coverage, adjacent to where the concurrency suite found a real deadlock.
3. **§21 — rate limiting is enforced and durable.** The largest untested
   security control; §7's brute-force counters ride on the same machinery.
4. **§29 — the waitlist offers a freed slot transactionally.** Same
   transactional shape as reschedule, same absence of coverage.
5. **§26 — family membership is not by itself permission to read a record.** A
   privacy rule with no test.
6. **§7 — brute-force resistance on sign-in.**
7. **§30 — removing a dependent retains their clinical record.**
8. **§46 — documents are referenced by record, never by public URL.**
9. **§43 — audio fallback for low-bandwidth users.**
10. **§48/§49 — the DB client survives a warm serverless invocation.**

Rows count obligations, not brief clauses: a clause with three separable
guarantees appears three times, because each can regress independently.

### Two caveats that apply to the whole document

**Every row above is proved at the API level or below.** No requirement here is
proved through the rendered interface, because no E2E specs are written. A
requirement can be fully satisfied by the API and still be unreachable for a
user whose button does not work — which is exactly what happened with the
"Confirm appointment" CSRF defect recorded in [TESTING.md](TESTING.md). That
defect reached a human tester rather than a test, and it is the clearest
argument in this project for writing the Playwright specs.

**The Ref column is incomplete by design, not by accident.** Clause numbers
appear only where the source tree cites them. Completing it means one pass
against the brief PDF, assigning numbers to the ~25 rows marked **—** and
confirming the ones already present. That pass has not been done, and until it
is, this document proves that requirements are tested but not that *every clause
of the brief* is represented — which is a weaker claim and should be read as
such.
