# Database

PostgreSQL, accessed through Drizzle ORM. All timestamps are stored in UTC and
rendered in the display timezone (`DISPLAY_TIMEZONE`, default `Asia/Dhaka`).

## Drivers

`lib/db/client.ts` picks one of three at runtime, from the environment:

| Driver | When | Notes |
|---|---|---|
| `neon` | `DATABASE_URL` points at Neon / Vercel Postgres | HTTP, no socket to keep warm — the right shape for serverless |
| `pg` | any other PostgreSQL URL | node-postgres, small pool (3 in production, 10 in dev) |
| `pglite` | no `DATABASE_URL` | Postgres compiled to WASM, in-process. **Refused in production** by the env validator |

PGlite is what makes `npm run dev` and `npm test` work on a clean checkout with
no infrastructure. It is real Postgres, so CHECK constraints, triggers and
`btree_gist` exclusion constraints behave exactly as they do on a server.

It is single-connection, so it cannot exercise genuine concurrency. The
concurrency suite (`npm run test:concurrency`) runs against `DATABASE_URL_TEST`
from `docker-compose.yml`.

## Commands

```bash
npm run db:generate   # regenerate migration SQL from lib/db/schema/*
npm run db:migrate    # apply pending migrations
npm run db:seed       # reference data + synthetic demo directory
npm run db:reset      # drop the schema (development only)
npm run db:studio     # drizzle-kit studio
```

## Layout

`lib/db/schema/` is split by domain and re-exported from `index.ts`:

| File | Tables |
|---|---|
| `enums.ts` | every `pgEnum` |
| `identity.ts` | `users`, `patients`, `sessions`, `auth_tokens`, `family_accounts`, `family_members` |
| `directory.ts` | `divisions`, `districts`, `specialties`, `facilities`, `doctors`, `doctor_specialties`, `doctor_locations`, `doctor_verifications`, `doctor_documents` |
| `scheduling.ts` | `doctor_availability`, `availability_exceptions`, `appointments`, `appointment_status_history`, `waitlist_entries`, `video_sessions` |
| `clinical.ts` | `medical_records`, `prescriptions`, `prescription_items`, `reviews` |
| `ai.ts` | `ai_triage_sessions`, `ai_visit_summaries`, `safety_events` |
| `platform.ts` | `notifications`, `payments`, `payment_webhook_events`, `audit_logs`, `rate_limit_counters`, `job_runs` |

Only `lib/repositories/*` may import `lib/db/client`. ESLint enforces it.

## Identifiers

Primary keys are `uuid` from `gen_random_uuid()` — non-sequential, so a row's id
reveals nothing about volume and cannot be walked. Human-facing identifiers
(`patients.patient_code`, `appointments.reference`,
`prescriptions.prescription_number`) are separate display columns, never keys.

Reference tables (`divisions`, `districts`, `specialties`, `facilities`) keep
stable text ids such as `dhaka` and `cardiology`, because they are a vocabulary
rather than records, and the frontend already uses those strings.

## Appointment integrity

This is the correctness property the platform lives or dies on. Two guards, both
at the database, both filtered to live statuses so a cancellation frees the slot.

**1. Exact-duplicate guard** — the prototype's constraint, kept:

```sql
CREATE UNIQUE INDEX uq_appointments_doctor_start_live
  ON appointments (doctor_id, start_utc)
  WHERE status NOT IN ('cancelled', 'no_show');
```

**2. Overlap guard** — the one that actually matters:

```sql
ALTER TABLE appointments ADD CONSTRAINT ex_appointments_no_overlap
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(start_utc, end_utc, '[)') WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show'));
```

Guard 1 alone is **not sufficient**, and the brief is right to say so. A
10:00–10:30 booking and a 10:15–10:45 booking have different start times, so
guard 1 permits both. Only the exclusion constraint rejects the second. This
required adding `end_utc` to the table — the prototype stored a start time only,
which made the overlap case literally unrepresentable.

The half-open range `'[)'` is deliberate: an appointment ending at 10:30 and one
starting at 10:30 are adjacent, not overlapping.

A matching constraint stops one *patient* being in two consultations at once.

A violation raises SQLSTATE `23P01`, which the booking service maps to
`APPOINTMENT_CONFLICT` / HTTP 409.

`lib/db/__tests__/constraints.test.ts` asserts all of this against a real
database, including the exact case from the brief.

## Constraints that encode safety rules

Several rules that would normally live only in application code are additionally
pinned in the schema, so no code path — including a future one — can violate
them:

| Constraint | Guarantee |
|---|---|
| `ck_ai_summary_requires_review` | An AI visit summary cannot be stored claiming it needs no review. A `DEFAULT` can be overridden by an `INSERT`; a `CHECK` cannot. |
| `ck_ai_summary_publish_needs_approval` | A summary can only be published into the record once a human approved it. |
| `ck_triage_no_downgrade` | The final triage urgency may never be less severe than what the deterministic rules produced. |
| `ck_triage_red_flag_is_emergency` | A red-flagged session must be an emergency **and** must never have been sent to a model. |
| `ck_doctors_verified_has_evidence` | A real doctor cannot reach `verified` without a registration number and a verification date. |
| `ck_doctors_demo_has_no_registration` | A synthetic profile cannot carry a registration number at all. |
| `ck_payments_succeeded_verified` | A non-mock payment cannot be `succeeded` without a verified webhook. |

### Why demo profiles carry no registration number

The prototype's seed generator issued plausible-looking BM&DC numbers
(`A-60000`, `A-60007`, …). Those are fabricated credentials that could collide
with a real practitioner's registration — someone could look one up and find a
real doctor attached to an invented profile. Brief §11 forbids it, and the
schema now makes the state unrepresentable rather than merely discouraged.

## Append-only tables

`audit_logs`, `appointment_status_history` and `safety_events` reject `UPDATE`
and `DELETE` via a trigger. "We tidied up the audit trail" is not something the
application can do by accident.

`medical_records` is append-only in substance: a trigger freezes the clinical
content (patient, author, kind, title, body, file, timestamps) once written. A
correction inserts an **amendment** row whose `supersedes_id` points at what it
replaces, and flips the original's `is_current` flag. Nothing is ever
overwritten, and nothing is ever deleted (brief §12, §30).

## Deviations from the brief's table list

Two, both deliberate and both documented here rather than done quietly.

**`rate_limit_events` → `rate_limit_counters`.** The brief sketches one row per
request. A fixed-window counter is used instead: a single atomic
`INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count` costs one
round trip and O(1) storage, where an events table costs a row per request plus
an aggregate on every check. The properties the brief actually asks for —
durable, shared across serverless invocations, never process memory — are
unchanged.

**`emergency_events` → folded into `safety_events`.** The brief lists
`emergency_events` under optional tables and separately asks (§32) for an
internal safety event model covering triage outcomes, rule activations, LLM
failures, rejected output and doctor overrides. Emergencies are one type in that
taxonomy. Keeping a single ordered event stream makes the safety timeline for a
consultation readable in one query; splitting it would mean joining two tables to
answer "what happened here".

`safety_events.detail` carries rule identifiers, versions and counts — never
symptom text and never a diagnosis, so a safety dashboard can be built without
exposing anyone's medical information.
