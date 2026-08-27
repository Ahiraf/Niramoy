# Deployment

## Vercel

1. Import the repository.
2. Add a Vercel Postgres (Neon) store — this sets `POSTGRES_URL` and
   `POSTGRES_URL_NON_POOLING`.
3. Set the required variables (below).
4. `npm run db:migrate` against the non-pooled URL.
5. Deploy. `vercel.json` registers the cron schedules.

## Required in production

`APP_ENV=production` makes these mandatory and the app **refuses to boot**
without them:

| Variable | Why |
|---|---|
| `DATABASE_URL` (or `POSTGRES_URL`) | PGlite is refused in production |
| `SESSION_SECRET` | ≥32 chars. `openssl rand -base64 48` |
| `NIRAMOY_ADMIN_CODE` | Otherwise the default gates admin sign-up |
| `CRON_SECRET` | ≥32 chars. Cron endpoints mutate appointment status |

`ALLOW_DEMO_PROFILES` defaults to **false** in production. The seed refuses to
run, so synthetic profiles cannot reach a production directory.

## Optional providers

Each falls back to a safe mock. Unset means the feature degrades honestly rather
than failing.

| Unset | Behaviour |
|---|---|
| `AI_API_KEY` / `AI_BASE_URL` | Deterministic rules only. **No patient text leaves the system** |
| `EMAIL_API_KEY` | Email logged, not sent. Verification and reset links appear in the log |
| `VIDEO_API_KEY` | Demo room. Real scoped token, no media. UI says so |
| `PAYMENT_API_KEY` | Mock provider. Nothing charged, labelled throughout |
| `BMDC_API_URL` | Every application goes to the admin queue. Never auto-approves |
| `RATE_LIMIT_STORE_URL` | Postgres counters — correct, no extra infrastructure |

## Migrations

`npm run db:migrate` runs each migration in a transaction, so a failure rolls
back rather than leaving the schema half-applied. Use the **non-pooled**
connection: a pooler can cut a long DDL transaction.

Before a production migration: back up, apply to a staging copy, verify, and
have a rollback plan. `0001_integrity_constraints.sql` adds constraints that
will **fail** if existing data violates them — which is the point, but it means
data has to be cleaned first, not after.

`npm run db:reset` is destructive and refuses to run when `APP_ENV=production`.

## Health checks

Point the platform's liveness probe at `/api/health` — it deliberately does not
touch the database, so a database blip does not cause a restart loop.

Point readiness at `/api/ready`, which returns 503 when the database is
unreachable and reports which driver is in use. `ephemeral: true` means the
in-process database is in play, which should never be true in production.

## Cron

Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Elsewhere, any scheduler
that can set a header will do. Jobs are idempotent, so overlapping or repeated
invocations are safe.

| Job | Schedule |
|---|---|
| `appointment-reminders` | hourly |
| `no-show-sweep` | every 15 min |
| `waitlist-offers` | every 5 min |
| `expiry-sweep` | daily 03:30 |
| `notification-retry` | every 15 min |

## Before real patients

Read `REGULATORY_ASSUMPTIONS.md` and `FINAL_IMPLEMENTATION_REPORT.md` first.
Several items require legal review, and the AI rule set requires clinical
review. This build is **not** ready for real patients.
