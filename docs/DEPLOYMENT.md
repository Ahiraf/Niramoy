# Deployment

## Vercel

1. Import the repository.
2. Add a Vercel Postgres (Neon) store — this sets `POSTGRES_URL` and
   `POSTGRES_URL_NON_POOLING`.
3. Set the required variables (below).
4. `npm run db:migrate` against the non-pooled URL.
5. Deploy. `vercel.json` registers the cron schedules — read the section below
   before assuming they all run.

## Scheduled jobs, and what the Hobby plan costs

Vercel's Hobby plan allows **2 cron jobs per project, running once a day**.
`vercel.json` is cut to fit that, which means three jobs no longer run on a
schedule:

| Job | Scheduled | Consequence when unscheduled |
|---|---|---|
| `appointment-reminders` | 03:00 daily | — |
| `no-show-sweep` | 03:30 daily | — |
| `waitlist-offers` | **not scheduled** | A cancelled slot is not offered to the waitlist automatically. Nothing is lost; the offer simply waits |
| `notification-retry` | **not scheduled** | A notification that failed to send is not retried |
| `expiry-sweep` | **not scheduled** | Expired verification rows and rate-limit counters are never purged. Harmless at demo scale; unbounded growth eventually |

`REMINDER_WINDOW_MINUTES=1440` is **required** when reminders run daily, and is
the setting most likely to be missed. Each run looks at appointments starting
`REMINDER_LEAD_HOURS` (24) from now, for exactly one window. Left at the hourly
default of 60, a daily run reminds one hour's worth of patients and skips the
other twenty-three — without erroring, and with nothing on screen to show for
it.

The endpoints all still work. Two ways to get the unscheduled jobs running:

- **Upgrade to Pro** and restore the schedules from git history, or
- **Point an external scheduler** (cron-job.org and similar are free) at
  `https://<your-app>/api/cron/<job>` with the `CRON_SECRET` as a bearer token.
  This keeps the code exactly as designed and costs nothing.

Either way, set `REMINDER_WINDOW_MINUTES` back to `60` if reminders return to
an hourly schedule.

## Required in production

`APP_ENV=production` makes these mandatory and the app **refuses to boot**
without them:

| Variable | Why |
|---|---|
| `DATABASE_URL` (or `POSTGRES_URL`) | PGlite is refused in production |
| `SESSION_SECRET` | ≥32 chars. `openssl rand -base64 48` |
| `NIRAMOY_ADMIN_CODE` | Otherwise the default gates admin sign-up |
| `CRON_SECRET` | ≥32 chars. Cron endpoints mutate appointment status |

Also set, though the app boots without them:

| Variable | Why |
|---|---|
| `APP_URL` | Your production URL. The CSRF origin check enforces it strictly once named, so a preview deployment's hostname will be rejected |
| `REMINDER_WINDOW_MINUTES` | `1440` when reminders run daily. See the cron section |
| `ALLOW_PUBLIC_VIDEO_ROOM` | `true` to permit credential-free `meet.jit.si` rooms. Production refuses them by default: the room is unlisted, not access-controlled |
| `ALLOW_DEMO_PROFILES` | `true` to seed the demo directory. Defaults to false in production so synthetic profiles cannot reach a real one |

`ALLOW_DEMO_PROFILES` defaults to **false** in production. The seed refuses to
run, so synthetic profiles cannot reach a production directory.

## Optional providers

Each falls back to a safe mock. Unset means the feature degrades honestly rather
than failing.

| Unset | Behaviour |
|---|---|
| `GEMINI_API_KEY_1..3` / `OPENAI_API_KEY` / `AI_API_KEY` | Deterministic rules only. **No patient text leaves the system**. Set any one to enable the model layer; they are tried in that order |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` | Email logged, not sent — verification and reset links appear in the log and reach nobody. Gmail works with 2-step verification on and an **App Password**; `npm run email:check -- you@example.com` sends a real test. `EMAIL_API_KEY` selects Resend instead, which needs a domain you control DNS for |
| `VIDEO_API_KEY` | Demo room. Real scoped token, no media. UI says so |
| `SSLCOMMERZ_STORE_ID` / `SSLCOMMERZ_STORE_PASSWORD` | Mock provider. Nothing charged, labelled throughout. Set both for real bKash through the SSLCommerz sandbox — see below |
| `BMDC_API_URL` | Every application goes to the admin queue. Never auto-approves |
| `RATE_LIMIT_STORE_URL` | Postgres counters — correct, no extra infrastructure |

## Payments (bKash via SSLCommerz)

`PAYMENT_PROVIDER=bkash` and `=nagad` are **scaffolding and will break
checkout** — `createPayment` throws `PROVIDER_UNAVAILABLE`, because a direct
merchant agreement needs a trade licence and a signed contract. Only their
webhook signature verification is real.

The working route is **SSLCommerz**, an aggregator that fronts bKash behind one
merchant account. Its sandbox is self-service and free:

1. Register at <https://developer.sslcommerz.com/> and take the sandbox
   `store_id` and `store_passwd`.
2. Set `SSLCOMMERZ_STORE_ID` and `SSLCOMMERZ_STORE_PASSWORD`. Both together —
   one alone is refused at boot rather than silently falling back to the mock.
3. Deploy, then set the IPN URL in the SSLCommerz merchant panel to
   `https://<your-app>/api/payments/webhook`.
4. `npm run pay:check` opens a real sandbox session and prints the hosted page
   URL, so a bad credential is caught before a demo rather than during one.

**IPN needs a public URL.** SSLCommerz cannot reach `localhost`, so settlement
only works once deployed. Locally the gateway page opens and the payment stays
`pending` — that is the expected local behaviour, not a bug.

### What settles a payment

A redirect gateway means the payer spends the middle of the flow on somebody
else's domain, and both the return URL and the IPN URL are public endpoints
anyone can POST to. So neither is believed:

- The `val_id` in a callback is only a lookup key. What settles the payment is a
  server-to-server call to SSLCommerz's validation API asking about that id.
- The **validated amount is checked against the stored payment row**. A
  mismatch is recorded as `amount_mismatch` and left unsettled for a human —
  this is the control that catches a tampered or forged callback naming a real
  transaction.
- Every `val_id` is recorded, so the IPN and the browser return racing each
  other resolves to one settlement rather than two.
- `ck_payments_succeeded_verified` means the database itself will not store a
  non-mock `succeeded` without `webhook_verified_at` set.

`SSLCOMMERZ_SANDBOX` defaults to `true`. Setting it to `false` points at the
live gateway where real money moves, and **production refuses to boot with it**
— this build has had no clinical or legal review. See
`REGULATORY_ASSUMPTIONS.md` A7.

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

What is actually scheduled is what `vercel.json` registers, and the Hobby plan
caps that at two jobs, once a day each. The rest are reachable endpoints with no
schedule attached — see the table in "Scheduled jobs" above for what that costs.

| Job | Scheduled by `vercel.json` | Ideal cadence if you add a scheduler |
|---|---|---|
| `appointment-reminders` | 03:00 daily | hourly (then set `REMINDER_WINDOW_MINUTES=60`) |
| `no-show-sweep` | 03:30 daily | every 15 min |
| `waitlist-offers` | not scheduled | every 5 min |
| `expiry-sweep` | not scheduled | daily |
| `notification-retry` | not scheduled | every 15 min |

## Before real patients

Read `REGULATORY_ASSUMPTIONS.md` and `FINAL_IMPLEMENTATION_REPORT.md` first.
Several items require legal review, and the AI rule set requires clinical
review. This build is **not** ready for real patients.
