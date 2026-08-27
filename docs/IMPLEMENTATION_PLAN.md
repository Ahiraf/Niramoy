# Niramoy — Implementation Plan

Turning the existing frontend prototype into a secure, testable, production-capable
full-stack application. Written after a full read of the repository at commit
`627a221`. Nothing here has been implemented yet except this document.

---

## 1. Repository audit

### 1.1 What the project is today

| Aspect | Finding |
|---|---|
| Framework | Next.js `^15.0.0`, React `^19.0.0`, **App Router** |
| Language | **JavaScript only.** No `tsconfig.json`, no `.d.ts`, no JSDoc-driven checking |
| Package manager | **npm** (`package-lock.json` present) |
| Lint / typecheck | **None.** No ESLint config, no `lint` or `typecheck` script |
| Tests | Jest, `testEnvironment: node`, **15 tests in one file** (`lib/__tests__/scheduling.test.js`) |
| Dependencies | `next`, `react`, `react-dom` only. Dev: `jest`, `@jest/globals` |
| Total source | ~8,600 lines across 50 files |
| Datastore | **In-memory objects on `globalThis`** (`lib/store.js`, `lib/auth.js`) |
| Migrations | None. `db/schema.sql` is a hand-written sketch, never executed |
| CI/CD | None |

### 1.2 Routing and UI structure

There is **exactly one Next.js page**: `app/page.js`. It is a `"use client"`
component that holds all application state in `useState` and routes between views
by a string (`active`) rather than by URL. `app/layout.js` is a 14-line shell.

Views are plain components under `app/components/`:

```
landing.js  auth-page.js  shell.js (Sidebar/Topbar)  ui.js  icons.js  settings.js
join-as-doctor.js  doctor-workspace.js  admin-workspace.js
patient/{dashboard,find-doctors,booking,appointments,assistant,records}.js
```

Design system is a single 831-line `app/globals.css`. **This is to be preserved
untouched.**

### 1.3 The most important finding

**The frontend is not mock-driven.** Components do not hold fake arrays of doctors
or appointments. Every component reaches the server through one typed client,
`app/lib/api.js`, which calls 20 real route handlers. The only hardcoded arrays in
components are static UI copy (`ROLE_CARDS`, `STEPS`, `PERIODS`, `TABS`, `SORTS`,
`WEEKDAYS`, demo-credential hints).

The mocking lives **behind the API boundary**, in two in-memory modules:

- `lib/store.js` — doctors, appointments, prescriptions, records, notifications,
  reviews, waitlist, family, verification queue
- `lib/auth.js` — users, sessions

This is very good news for the brief's "do not rebuild the frontend" constraint:
**almost no component needs to change.** The work is replacing the two in-memory
modules with a real persistence and service layer behind the same HTTP contract,
plus fixing the authorization holes in the route handlers.

### 1.4 Feature status

| Area | Status |
|---|---|
| Landing, sign-in/sign-up UI (3 roles) | Complete frontend, backend-ready |
| Doctor discovery, filters, sort, paging | Complete frontend; server-side search over an in-memory array |
| Doctor profile + reviews | Complete frontend |
| Slot calendar + booking | Complete frontend; real scheduling engine; **not transactional** |
| Appointments list, cancel, reschedule | Complete frontend; **no ownership checks** |
| Video consultation | **Placeholder only** (`patient/appointments.js:296` — a styled UI with a timer, no provider) |
| Medical records + prescriptions | Complete frontend; **no access control** |
| Family accounts | Complete frontend; **no ownership checks** |
| Waitlist | Complete frontend; notify-only, no claim window |
| Reviews | Complete frontend; **no eligibility check** |
| Notifications | In-app only, in-memory. **No email, no delivery, no reminders** |
| Doctor verification (BM&DC) | **Complete and well-designed** end-to-end; the only role-gated endpoints in the app |
| AI triage | Rule engine + optional LLM; red flags short-circuit correctly |
| AI visit summary | Draft + `requiresReview: true`; **no approval workflow, no auth** |
| Admin dashboard | Complete frontend |
| Payments | Mocked, and **honestly labelled as mocked** in the UI |
| Cron / reminders / no-show | **Missing** |
| Rate limiting, audit log, observability | **Missing** |

### 1.5 Security findings (from reading all 20 route handlers)

These are the highest-priority items in the whole project. Ranked.

**S1 — Blanket IDOR on every patient-scoped endpoint.** `app/api/_lib.js:patientIdFor()`
returns `sessionUser(request)?.patientId ?? CURRENT_PATIENT.id`. Each route then does
`query(request).patientId ?? patientIdFor(request)` — **preferring a client-supplied
id over the session**. Any caller can read or write any patient's data by passing
`?patientId=`. Affects `/api/records`, `/api/prescriptions`, `/api/appointments`,
`/api/family`, `/api/waitlist`, and `/api/notifications` (via `userId`).

**S2 — Anonymous access to patient data.** The same fallback means a signed-out
request is served the demo patient's records rather than a 401. Almost no endpoint
calls `sessionUser()` at all.

**S3 — A patient can create a prescription.** `POST /api/prescriptions` and
`POST /api/records` (with `kind: "prescription"`) perform no role check. Violates
brief §13.

**S4 — Unowned appointment mutation.** `PATCH /api/appointments/[id]` cancels,
reschedules or completes by id with no check that the caller is the patient or the
doctor on that appointment.

**S5 — Review forgery.** `POST /api/reviews` never verifies the appointment exists,
is `completed`, or belongs to the caller. Only a duplicate-per-appointment check.

**S6 — Unowned deletes.** `DELETE /api/family?id=` and `DELETE /api/waitlist?id=`
delete by raw id with no ownership check.

**S7 — Credential data over the wire.** `GET /api/doctors/:id` returns the raw
doctor record including `bmdcNumber`.

**S8 — No CSRF protection.** Cookie auth with `SameSite=Lax` and state-changing
`POST`/`PATCH`/`DELETE` routes, no token, no origin check.

**S9 — Auth lifecycle gaps.** No email verification, no password reset, no session
rotation on login, no expired-session sweep, no rate limiting, no failed-login
tracking. `ADMIN_CODE` has an insecure default (`NIRAMOY-ADMIN`) compared with `!==`.

**S10 — AI endpoints unauthenticated and unbounded.** `/api/ai/triage` and
`/api/ai/summary` accept any body from anyone, with no length cap and no rate limit.

*Good news:* password hashing (scrypt + `timingSafeEqual`), opaque 32-byte session
tokens, `HttpOnly` + `SameSite=Lax` + `Secure`-in-prod cookies, non-leaking login
failure messages, and the admin gate on `/api/verification` are all already correct
and will be preserved.

### 1.6 Correctness findings

**C1 — Appointments have no end time.** `appointments` records carry `startUtc`
only. `canBook()` matches on **exact start-time equality** against the generated
slot set. The system therefore *cannot represent* the overlap case the brief
mandates in §5 (10:00–10:30 vs 10:15–10:45). Slot length lives on the availability
rule (`slotMinutes`); `doctor.consultationMinutes` exists but the engine ignores it.
**Fix requires a schema change (`end_utc`), not just a query change.**

**C2 — Booking is a non-transactional read-then-write.** `bookAppointment()`
generates slots, checks a JS `.some()` for a clash, then pushes to an array. Two
concurrent requests both pass. The `UNIQUE (doctor_id, start_utc)` in `db/schema.sql`
would help but is unexecuted, and is insufficient for C1 anyway.

**C3 — Reschedule can lose an appointment.** `rescheduleAppointment()` sets the old
appointment to `cancelled`, calls `bookAppointment()`, and on failure sets it back to
`confirmed`. Non-atomic; a crash between the two leaves the patient with nothing. It
also creates a *new* appointment row rather than moving the existing one, so history
and any linked prescription detach.

**C4 — `db/schema.sql` is a sketch, not the target schema.** Missing: `sessions`,
`waitlist`, `family_*`, `doctor_verifications`, all AI tables, all audit tables.
`medical_records` has no author. `prescriptions` has no `patient_id`. Ids are
`BIGSERIAL` (sequential — brief §4 asks for non-sequential). No `end_utc`, no
exclusion constraint.

**C5 — Mixed module systems.** `lib/scheduling.js` uses CommonJS `module.exports`
but is consumed via an ESM default import in `lib/store.js`. Works today; must be
resolved during the TypeScript migration.

**C6 — Circular coupling.** `lib/auth.js` imports `CURRENT_PATIENT` from
`lib/store.js`; `app/api/_lib.js` imports from both. `CURRENT_PATIENT` is a global
singleton "the signed-in demo patient" that must be deleted entirely.

**C7 — AI: the LLM can downgrade urgency.** In `lib/ai.js:triage()`, red flags
correctly short-circuit before any model call. But for non-red-flag input,
`urgency = parsed.urgency` is taken from the model with no floor against
`rules.urgency`, so the model can move `urgent` down to `self_care`. Brief §15
forbids this. Output is also parsed with a bare `JSON.parse` and no schema
validation (it fails *safe* — a throw falls back to rules — but unvalidated fields
still reach the UI). No input length cap. No prompt/model versioning. No safety-event
log.

**C8 — Bangla red flags are effectively non-functional.** `RED_FLAGS` uses `\b`
word boundaries, which do not match Bangla script at all, and contains exactly one
transliterated term (`buke betha`). Brief §16 requires Bangla and Banglish.

### 1.7 Environment variables in use today

`.env.example` declares `POSTGRES_URL`, `POSTGRES_PRISMA_URL`,
`POSTGRES_URL_NON_POOLING`, `NIRAMOY_ADMIN_CODE`, `AI_API_KEY`, `AI_BASE_URL`,
`AI_MODEL`, `DAILY_API_KEY`, `RESEND_API_KEY`, `BMDC_API_URL`. Only
`NIRAMOY_ADMIN_CODE`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` and `BMDC_API_URL` are
actually read by code. The app runs with none set — a property worth keeping for the
academic demo.

---

## 2. Architecture decisions

Decisions taken now so later phases do not relitigate them.

**D1 — ORM: Drizzle.** SQL-first, so the exclusion constraint, `FOR UPDATE` locking
and `tstzrange` stay expressible without escape hatches; no query-engine binary
(materially better cold starts than Prisma on serverless); `drizzle-kit` gives real
migration files; works with the Neon serverless driver over HTTP. One ORM, used
consistently.

**D2 — TypeScript: incremental, not a rewrite.** Add `tsconfig.json` with
`strict: true` **and `allowJs: true`**. All new backend code is `.ts`. Existing
`lib/*.js` converts in the phase that touches it. Components stay `.js` and convert
only when a phase must edit them. This satisfies §57 without violating "make only
the minimum necessary frontend changes".

**D3 — Preserve the HTTP contract, replace what is behind it.** Response envelopes
stay `{ ok: true, ... }` / `{ ok: false, reason, message }` because `app/lib/api.js`
and every component depend on them. Brief §34's structured error shape is added
**alongside** as an `error: { code, message }` field, not instead of — so nothing in
the UI breaks. New endpoints from §9 that the frontend does not yet call are added as
new paths; existing paths are kept as-is or aliased.

**D4 — `lib/store.js` is replaced domain by domain, not converted into a facade.**

*Originally planned as a delegating facade in Phase 1; revised during Phase 1 after
attempting it.* The facade approach fails on identity: seeded doctors now carry
`uuid` primary keys, while the in-memory store holds `nrm-d-0001`-style ids that
its appointments, prescriptions and reviews all reference. A store that reads
doctors from Postgres while appointments stay in memory is not half-migrated, it is
broken — the foreign keys point at rows that do not exist.

So `lib/store.js` stays untouched and fully working through Phase 1, and each
domain moves in the phase that owns it, complete with its transactional service
and its authorization rules at the same time. That is also the safer ordering:
authorization lands with the data access it protects, rather than after it. The
module is deleted at the end of Phase 5.

**D5 — Overlap prevention: PostgreSQL exclusion constraint.** Add `end_utc` to
appointments, enable `btree_gist`, and declare:

```sql
EXCLUDE USING gist (
  doctor_id WITH =,
  tstzrange(start_utc, end_utc, '[)') WITH &&
) WHERE (status NOT IN ('cancelled', 'no_show'))
```

`UNIQUE (doctor_id, start_utc)` is kept as a cheap secondary guard. Booking runs in a
transaction; a `23P01` exclusion violation maps to `APPOINTMENT_CONFLICT` / HTTP 409.
Serialization failures (`40001`) and deadlocks (`40P01`) get bounded retry.

**D6 — Identifiers: `uuid` PKs via `gen_random_uuid()`.** Non-sequential per §4, no
extension needed on PG13+. Human-facing codes (`patientCode`, prescription number)
become separate, short, non-guessable display columns.

**D7 — Rate-limit store: interface + Postgres adapter (default) + Redis adapter.**
A Postgres-backed fixed-window counter is durable, correct across serverless
invocations, and needs no extra infrastructure for the academic deployment —
satisfying §21's "not process memory" without forcing a Redis dependency. An Upstash
Redis adapter is provided behind the same interface for scale, selected by
`RATE_LIMIT_STORE_URL`.

**D8 — Test databases.** Integration tests run against PGlite (in-process real
Postgres, fast, no Docker). **Concurrency tests require a real server** — PGlite is
single-connection — so they run against `DATABASE_URL_TEST` from the provided
`docker-compose.yml`, and skip with a loud explanatory message when it is unset.
This keeps `npm test` green on a laptop with no Docker while making §39 genuinely
executable in CI.

**D9 — Timezones: `@date-fns/tz` (or `Temporal` polyfill), never a hardcoded offset.**
`BD_OFFSET_MINUTES = 360` in `lib/data/doctors.js` and the manual arithmetic in
`describeSlot()` are replaced with an IANA zone (`Asia/Dhaka`) resolved from config.
Storage stays UTC. Bangladesh has no DST today, but the offset is not hardcoded.

**D10 — Provider abstractions everywhere external.** `VideoProvider`,
`AIProvider`, `NotificationProvider`, `PaymentProvider`, `RateLimitStore`,
`BmdcVerifier`. Each ships a safe mock/demo implementation so the app continues to
run with zero environment variables — an existing property of the codebase that is
worth protecting.

### Target layout

```
lib/
  auth/          sessions, passwords, tokens, CSRF
  db/            drizzle client, schema, migrations, pool
  repositories/  one module per aggregate; the only code that touches db/
  services/      business logic; transactions live here
  scheduling/    pure engine (moved from lib/scheduling.js, now TS)
  ai/            providers, rule engine, schemas, safety policy
  notifications/ providers + templates
  validation/    Zod schemas shared by routes and services
  security/      authz helpers, rate limiting, headers
  audit/         append-oriented audit log
  video/         provider abstraction
  payments/      provider abstraction
  config/        env parsing and validation (Zod)
  errors/        typed error classes → HTTP status mapping
  observability/ request ids, structured logging
```

Every route handler becomes: `authenticate() → authorize() → validate() → service → respond`.

---

## 3. Phase plan

Each phase ends with: tests pass, typecheck passes, build passes, frontend still
works, decisions documented.

| Phase | Scope | Key exit criteria |
|---|---|---|
| **1. Foundation** ✅ | tsconfig + ESLint + scripts; `lib/config` env parsing; Drizzle + full schema + integrity migration; PGlite/docker test DBs; directory repositories; typed errors; structured logging; `/api/health`, `/api/ready`; seed script | ✅ `db:migrate` + `db:seed` work; directory reads live from Postgres; 36 tests pass; lint, typecheck and build clean |
| **2. Auth** | Argon2id (scrypt kept as legacy verifier for existing hashes); sessions in DB with rotation + expiry sweep; email verification; password reset (enumeration-resistant); CSRF; `requireUser/requireRole/requireOwnership` helpers; **fix S1–S6, S9** | Every security test case in brief §61 items 1–6, 13, 14 passes |
| **3. Doctors** | doctor profiles, specialties, availability, verification workflow with full status set (`PENDING/VERIFIED/REJECTED/SUSPENDED/EXPIRED`) and audit trail; `BmdcVerifier` adapter; only `VERIFIED` bookable; strip `bmdcNumber` from public payloads (**S7**) | Doctor sign-up → pending → admin approve → bookable, end to end |
| **4. Scheduling** | `end_utc` + exclusion constraint; transactional booking with retry; atomic reschedule (move, don't recreate — **C3**); cancellation window; waitlist claim window; port engine to TS with duration support (**C1**) | §39 concurrency tests pass: exactly one of N concurrent bookings succeeds; overlapping variable-duration booking rejected |
| **5. Medical data** | records (append-only + amendments), prescriptions (doctor-only), family accounts with explicit consent rules, reviews with eligibility; retire the `store.js` facade | §61 items 3, 4 pass; record history is not destructively editable |
| **6. Video** | `VideoProvider` interface; Daily or Jitsi server-side room + short-lived join token; participant authorization; no public URLs; no recording | Only the two participants can obtain a join token; token expires |
| **7. Notifications & cron** | `NotificationProvider` (email + in-app), templates, idempotent jobs, `CRON_SECRET`-authenticated endpoints, reminders, no-show sweep, token/session cleanup | Running a job twice sends nothing twice |
| **8. AI** | versioned rule set; Bangla/Banglish normalisation (**C8**); `AIProvider` abstraction; Zod-validated structured output; **urgency floor so the LLM can never downgrade (C7)**; prompt-injection handling; summary draft → doctor review → confirm → record; safety-event log; provenance columns | §61 items 9–12 pass; vignette suite green |
| **9. Payments** | `PaymentProvider` interface, clearly-labelled `MockPaymentProvider`, webhook signature verification + idempotency scaffolding for bKash/Nagad | Frontend's "payment is mocked" copy remains accurate and honest |
| **10. Hardening** | rate limiting on all §21 endpoints; security headers/CSP; audit logging; observability; E2E (Playwright); load test; CI pipeline | Full checklist in brief §60 satisfied or explicitly documented as not |

---

## 4. Frontend changes anticipated

Deliberately minimal. Expected to be the complete list:

1. **`app/lib/api.js`** — add CSRF token handling; add methods for new endpoints
   (password reset, email verification, video token, AI summary approval, payments).
   No signature changes to existing methods.
2. **`app/components/auth-page.js`** — add "forgot password" link and the reset/verify
   screens. New UI, existing design tokens.
3. **`app/components/patient/appointments.js`** — replace the video placeholder
   (`:283–320`) with the real provider iframe, keeping the existing control bar
   markup and CSS classes.
4. **`app/components/doctor-workspace.js`** — the AI summary panel gains an explicit
   "review and confirm" step before save; `useDoctorSelf`'s directory-lookup fallback
   (`:30–31`) is removed once accounts link to profiles properly.
5. **`app/page.js`** — `CURRENT_PATIENT`-shaped assumptions removed; error states
   surfaced for the new typed errors.
6. **`app/components/settings.js`** — password change UI.

`globals.css`, `landing.js`, `shell.js`, `ui.js`, `icons.js`, `find-doctors.js`,
`booking.js`, `dashboard.js`, `records.js`, `admin-workspace.js`, `join-as-doctor.js`
are expected to need **no changes**.

---

## 5. Open questions and assumptions

Recorded rather than silently resolved. Expanded in `docs/REGULATORY_ASSUMPTIONS.md`
in Phase 1.

- **A1** Medical-record retention period for Bangladesh — **REQUIRES LEGAL REVIEW.**
  Implemented as a configurable policy with no default deletion.
- **A2** Whether AI triage constitutes a regulated medical device — **REQUIRES LEGAL
  REVIEW.** Mitigated by the human-in-the-loop design regardless.
- **A3** Remote prescribing rules, and controlled substances in particular —
  **REQUIRES LEGAL REVIEW.** No controlled-substance handling will be implemented.
- **A4** Cross-border transfer of PHI to an LLM provider — **REQUIRES LEGAL REVIEW.**
  Mitigated by data minimisation and the rules-only default (no key = no data leaves).
- **A5** Video is implemented as video; no claim is made that it is legally
  equivalent to any specific telemedicine modality.
- **A6** The 144 synthetic profiles stay, keep `isDemoProfile: true`, and keep their
  visible badge. They will be excluded from any deployment where `APP_ENV=production`.
