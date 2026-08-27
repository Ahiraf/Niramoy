# Niramoy — নিরাময়

An **AI-assisted serverless telemedicine & appointment platform** for Bangladesh.
CSE-356 (Software Engineering Sessional) project — CUET.

Patients discover verified doctors, book conflict-free appointment slots, consult
over video, and keep a digital record of prescriptions and history. An AI layer
adds symptom triage, doctor recommendation, and automated visit summaries.

## Tech stack
- **Next.js** (React, App Router) — UI + serverless API routes
- **TypeScript** — all backend code; the UI is migrating incrementally
- **PostgreSQL + Drizzle ORM** — Neon / Vercel Postgres in production,
  node-postgres for a normal server, and an in-process
  [PGlite](https://pglite.dev) when no `DATABASE_URL` is set, so the project runs
  on a clean checkout with no infrastructure
- **Session auth** — email + password accounts for the three roles
  (patient / doctor / admin), hashed, HttpOnly session cookie
- **Vercel Cron** — appointment reminders + no-show sweep *(next increment)*
- **Jitsi / Daily** — embedded video consultation *(room placeholder in place)*
- **Gemma / OpenAI** — AI triage, recommendation, visit summaries

Double-booking is prevented by the database, not by the application: a
`btree_gist` **exclusion constraint** over `tstzrange(start_utc, end_utc)`
rejects any overlapping appointment for a doctor, whatever the durations
involved. A `UNIQUE (doctor_id, start_utc)` index is kept as a cheap secondary
guard, but on its own it is not sufficient — 10:00–10:30 and 10:15–10:45 share no
start time. See [`docs/DATABASE.md`](docs/DATABASE.md).

## Getting started
```bash
npm install
npm run db:migrate   # create the schema
npm run db:seed      # reference data + the synthetic demo directory
npm run dev          # http://localhost:3000
```

With no `.env.local`, all three commands run against an in-process PostgreSQL
(PGlite) stored in `.pglite/`. Set `DATABASE_URL` to point at a real server
instead; nothing else changes.

```bash
npm test              # unit + integration suites
npm run test:concurrency   # needs a real server — see docker-compose.yml
npm run lint
npm run typecheck
npm run build
npm run verify        # all of the above, in order
```

Signed out you get the landing page; sign-in and sign-up cover all three roles.
Three demo accounts are seeded so the app can be reviewed without signing up —
password `niramoy123` for each:

| Role | Email | What you land in |
|---|---|---|
| Patient | `nabila@example.com` | A workspace with seeded appointments, records and a prescription |
| Doctor | `ayesha@example.com` | Schedule, availability, earnings, prescription writer |
| Admin | `sakib@example.com` | Verification queue, directory, specialties |

Signing up as a doctor is the real path: the BM&DC number is format-checked at
sign-up, you complete the profile form, and the account stays on a "being
verified" screen until an admin approves it — only then is a bookable profile
published and linked to the account. Admin sign-up needs the staff invite code
(`NIRAMOY_ADMIN_CODE`, default `NIRAMOY-ADMIN`).

No environment variables are required to run the app. Everything works from the
seeded in-memory store; `.env.local` only adds the LLM and BM&DC integrations.

---

## Where the doctor data comes from

**Bangladesh has no public API or bulk registry of licensed doctors.** This is the
central data problem of the project, and the app is built around the answer rather
than around a pretend import. What actually exists:

| Source | What it gives you |
|---|---|
| [BM&DC verification service](https://verify.bmdc.org.bd/) | **One** registration number at a time, behind a captcha. Verifies; does not list. No official API, no bulk export. |
| [data.gov.bd — Doctor Directory](http://data.gov.bd/dataset/doctor-directory) | A real XLS. Advertises 5,369 rows; the portal serves a truncated file with **199 rows, Rajshahi division only**, last updated **Jan 2017**, licence unspecified, and it contains doctors' **personal mobile numbers**. |
| DGHS Facility / Provider Registry | Facilities and org structure, not a bookable provider list. |
| Commercial directories | Copyrighted third-party business data; scraping violates their terms. |

So Niramoy does what every real platform does, and what the proposal specifies:

```
doctor registers  →  submits BM&DC registration number
                  →  status: pending
                  →  admin confirms it at verify.bmdc.org.bd
                  →  status: verified  →  profile is live and bookable
```

This is implemented end-to-end — see `lib/bmdc.js`, the **Join as a doctor** form,
and the admin **Doctor verification** queue. Approving an application publishes a
real, non-demo profile into the same directory.

### What is seeded, and how it is labelled

To have something to demo before real doctors sign up, the directory ships with
**144 synthetic profiles** (`lib/data/doctors.js`), built on a *real* structural
backbone:

- the real **8 divisions / 64 districts** of Bangladesh (`lib/data/geo.js`)
- real, publicly-known **government hospitals** across all divisions (`lib/data/facilities.js`)
- a specialty taxonomy normalised from the **43 real DGHS specialty labels** (`lib/data/specialties.js`)
- realistic Bangladeshi qualification patterns (`MBBS, FCPS (Medicine)`, `BDS`, …)

Every seeded record carries `isDemoProfile: true` and renders a **Demo profile**
badge everywhere it appears. No real physician's name or phone number is used, and
the directory page states plainly what the data is.

The de-identified reference extract from the government dataset is kept at
[`db/reference/dghs-doctor-directory.json`](db/reference/dghs-doctor-directory.json)
— specialty labels, post titles, facility names and division/district/upazila
triples only. **Names, personal mobile numbers and home addresses were stripped.**

### Going live with real data

1. Doctors self-register (already built).
2. An admin verifies each BM&DC number by hand (already built).
3. *Optional:* if you obtain a real data-sharing endpoint, set `BMDC_API_URL` and
   `verifyRegistration()` will call it automatically, falling back to manual
   review if it is unreachable. It never fails open.
4. Remove the seed by calling `generateDoctors(0)` — nothing else depends on it.

We deliberately do **not** ship a captcha-solving scraper against BM&DC: the
captcha is an access control, and harvesting the register would violate its terms
and the privacy of practitioners who never agreed to be listed here.

---

## Project layout
```
Niramoy/
├─ app/
│  ├─ page.js                    # role-aware shell + view routing
│  ├─ globals.css                # the whole design system
│  ├─ lib/api.js                 # typed client for the API routes
│  ├─ components/
│  │  ├─ icons.js  ui.js  shell.js
│  │  ├─ landing.js              # public landing page
│  │  ├─ auth-page.js            # sign in / sign up for all three roles
│  │  ├─ patient/                # dashboard, find-doctors, booking,
│  │  │                          # appointments, assistant, records
│  │  ├─ doctor-workspace.js     # overview, schedule, availability, earnings,
│  │  │                          # prescription writer w/ AI draft
│  │  ├─ admin-workspace.js      # overview, verification queue, directory
│  │  └─ join-as-doctor.js       # BM&DC onboarding form
│  └─ api/                       # 20 route handlers (see below)
├─ lib/
│  ├─ db/
│  │  ├─ schema/                 # ★ the PostgreSQL schema, split by domain
│  │  ├─ migrations/             # drizzle-kit output + hand-written constraints
│  │  └─ client.ts               # driver selection (neon / pg / pglite)
│  ├─ repositories/              # ★ the only code that touches the database
│  ├─ config/env.ts              # validated, typed environment
│  ├─ errors/                    # typed errors → HTTP status mapping
│  ├─ observability/logger.ts    # structured logs, PHI redaction
│  ├─ api/respond.ts             # response envelope + route wrapper
│  ├─ auth/password.ts           # password hashing
│  ├─ scheduling.js              # ★ the scheduling engine (pure, testable)
│  ├─ auth.js                    # accounts, sessions      (in-memory, Phase 2)
│  ├─ store.js                   # prototype data layer    (in-memory, Phase 2-5)
│  ├─ bmdc.js                    # BM&DC validation + verification adapter
│  ├─ ai.js                      # triage, doctor matching, visit summary
│  └─ data/                      # geo, specialties, facilities, seeded doctors
├─ scripts/                      # migrate, seed, reset
├─ test/                         # jest setup + integration database harness
├─ docs/                         # architecture, database, AI safety, regulatory
├─ db/
│  ├─ schema.sql                 # superseded by lib/db/schema/ — kept for reference
│  └─ reference/                 # de-identified DGHS reference extract
└─ Niramoy_Proposal_updated.pdf
```

## API routes
```
GET    /api/auth                         current session ({user: null} when signed out)
DELETE /api/auth                         sign out
POST   /api/auth/login                   email + password + role
POST   /api/auth/register                sign up (doctor: BM&DC no.; admin: invite code)
GET    /api/reference                    specialties + divisions + facilities + stats
GET    /api/doctors                      search: text, specialty, division, district,
                                         language, maxFee, minRating, sort, paging
GET    /api/doctors/:id                  profile + reviews
GET    /api/doctors/:id/slots            bookable slots, grouped by day
GET    /api/appointments                 by patient or doctor
POST   /api/appointments                 book (conflict-checked, 409 on clash)
PATCH  /api/appointments/:id             cancel | reschedule | complete
GET    /api/records  POST                medical-history timeline
GET    /api/prescriptions  POST          prescriptions + items
GET    /api/notifications  POST          in-app bell, mark-read
GET    /api/family  POST  DELETE         family accounts
GET    /api/waitlist  POST  DELETE       waitlist + auto-notify on cancellation
GET    /api/reviews  POST                one review per completed appointment
POST   /api/ai/triage                    urgency + specialty + ranked doctors
POST   /api/ai/summary                   visit-summary draft (always requiresReview)
GET    /api/verification                 admin queue
POST   /api/verification                 doctor applies (BM&DC)
PATCH  /api/verification                 admin approve / reject
```

## The scheduling engine
`lib/scheduling.js` is the algorithmic heart and the module the Testing
deliverable is built around. It is **pure** (no DB, no network):

- `generateSlots(...)` — availability **rules − exceptions − booked − past/too-soon** → concrete slot times (UTC).
- `canBook(...)` — validates a booking request.
- `canCancel(...)` — enforces the cancellation window.

All times are stored in UTC and rendered in Bangladesh Standard Time by
`describeSlot()` in `lib/store.js`. The 15 tests in
`lib/__tests__/scheduling.test.js` cover double-booking, past/too-soon slots,
boundary slots, buffer time, exceptions overriding recurring rules, and the
cancellation window.

Two limitations are being addressed in Phase 4. The engine matches a booking
request by **exact start-time equality**, and an appointment carries no end time,
so a partial overlap between two different durations cannot be represented at
all. And the UTC+6 offset is arithmetic rather than a timezone: the schema now
stores availability as a local window plus its IANA zone (`Asia/Dhaka`) and lets
the engine convert.

## The data layer
`lib/repositories/*` is the only code permitted to touch the database — ESLint
enforces it — and the doctor directory is already served from PostgreSQL.

`lib/store.js` is the prototype's in-memory data layer, still backing the route
handlers. It is being retired domain by domain rather than converted into a
delegating facade: seeded doctors now carry `uuid` keys while the in-memory store
holds `nrm-d-0001`-style ids, so a store reading doctors from PostgreSQL with
appointments still in memory would have foreign keys pointing at rows that do not
exist. Each domain moves with its transactional service and its authorization
rules together — see `docs/IMPLEMENTATION_PLAN.md`.

## AI layer
`lib/ai.js` works **without an API key**, using a transparent rule engine, and
upgrades to an LLM when `AI_API_KEY` / `AI_BASE_URL` are set. Safety properties:

- Red-flag symptoms (chest pain, stroke signs, self-harm, …) short-circuit to
  emergency advice **before** any model is consulted, and are never passed to one.
- No code path can downgrade an emergency result.
- LLM failures fall back to the rule engine — fail safe, never fail open.
- Visit summaries are always returned `requiresReview: true`; the doctor edits and
  confirms before anything reaches a patient record.

## Known gaps (next increments)

The PostgreSQL layer is in place and the directory is served from it, but the
route handlers still read the prototype's in-memory store. Each domain moves
across in its own phase, together with the authorization rules that protect it —
see [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

- **Authorization is not yet enforced.** Patient-scoped routes accept a
  client-supplied `patientId` and prefer it over the session, so any caller can
  read any patient's data. Findings S1–S6 in the plan; fixed in Phase 2. **Do not
  expose this build to real data.**
- Accounts still live in memory, so a server restart clears them; passwords are
  hashed either way.
- No email verification or password reset yet.
- The video room is a styled placeholder, not an embedded Jitsi/Daily iframe.
- Payments are mocked, as the proposal scopes.
- Cron reminders / no-show sweep are not scheduled yet.

`docs/REGULATORY_ASSUMPTIONS.md` records what is legally established, what is a
working assumption, and what requires review before any real patient uses this.

## Deploy
Push to GitHub → import into Vercel → add a Vercel Postgres store → set the env
vars from `.env.example` → `npm run db:migrate`.

The app runs in development with none of them set. Production is stricter:
`APP_ENV=production` makes `DATABASE_URL`, `SESSION_SECRET`,
`NIRAMOY_ADMIN_CODE` and `CRON_SECRET` mandatory, refuses to boot on a defaulted
secret, and refuses to run on the in-process database.
