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
- **TextBee** — SMS through an Android handset on a Bangladeshi SIM: the
  six-digit code that proves a mobile number at sign-up, and reminders to
  numbers that were proved. With no key the code prints to the server log and
  the API says it was not delivered, so sign-up still works on a clean checkout
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

Signed out you get the landing page, which covers patients and doctors.
Administration is not advertised there: it is staff tooling on its own URL,
`/admin`, which opens straight at a staff sign-in. That split keeps the option
out of a patient's way — it is not a security boundary, and is not doing the
work of one. What protects administration is server-side: the staff invite code
at sign-up and the role check every admin API runs against the session.

Three demo accounts are seeded so the app can be reviewed without signing up —
password `niramoy123` for each:

| Role | Email | What you land in |
|---|---|---|
| Patient | `nabila@example.com` | A workspace with seeded appointments, records and a prescription |
| Doctor | `ayesha@example.com` | Schedule, availability, earnings, prescription writer |
| Admin | `sakib@example.com` | Verification queue, directory, specialties |

### Showing the video consultation

A consultation room only opens 15 minutes before the appointment and closes 30
minutes after it ends (`lib/services/video.ts`), so a seeded appointment next
week has nothing to join. Rather than weaken that rule for a demo, put an
appointment on the clock:

```bash
npm run demo:live               # starts 2 minutes ago, runs 20 minutes
npm run demo:live -- --in 5     # starts 5 minutes from now
npm run demo:live -- --minutes 45
```

It books `NRM-DEMO-LIVE` between the seeded patient and doctor. Re-running moves
the same appointment instead of creating another, and it refuses to run when
`ALLOW_DEMO_PROFILES` is false, which is the production default.

**Restart `npm run dev` afterwards.** On the default in-process database
(PGlite) the server owns its own copy: a script writing to `.pglite` from a
second process is invisible to a dev server that was already running, so the
appointment simply does not appear and it looks like the app has lost it. The
script warns when it detects this. Pointing `DATABASE_URL` at a real PostgreSQL
server removes the problem entirely.

**Turn on real video.** With no provider configured the room is a placeholder:
the join grant is real and scoped, but no media is carried, and the UI says so.
For a live two-way call put this in `.env.local` — no vendor account needed:

```
VIDEO_PROVIDER=jitsi
```

That uses a public `meet.jit.si` room whose name is random and given only to the
two participants. Real camera and microphone, both directions, nothing to sign
up for. It is *unlisted*, not access-controlled, so `APP_ENV=production` refuses
it and requires `VIDEO_API_KEY` / `VIDEO_API_SECRET` (JWT-authenticated Jitsi)
instead — worth saying out loud if you are asked about it.

**Two people, two machines.** Camera and microphone need a secure context, so
`http://192.168.x.x:3000` will not work — the browser blocks media on a plain
LAN address. Either:

- *One machine:* patient in a normal window, doctor in a second browser profile
  (or a private window). Both sides visible on one screen for the projector.
- *Two machines:* expose the dev server over HTTPS, e.g. `npx localtunnel --port
  3000`, and set `APP_URL` to the tunnel URL so the CSRF origin check matches.

Both sides use the same screen: the doctor presses **Open room** from Schedule,
the patient presses **Join call** from Appointments, and each sees the other
named in the call.

Signing up as a doctor is the real path, and it begins with an admin. Nobody can
create a doctor account unsolicited: an admin checks the registration number
against the BM&DC register by hand, records it on **Sign-up approvals** together
with the mobile number that doctor will use, and only that pair completes a
sign-up. The doctor then fills in the profile form and goes live — the number
was already checked by a person, so it is not put in a queue to be checked
again. A doctor who applies with some *other* number still lands in the
**Doctor verification** queue, because nobody has checked that one.

Admin sign-up needs the staff invite code (`NIRAMOY_ADMIN_CODE`, default
`NIRAMOY-ADMIN`), and the admin portal is at `/admin`.

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
admin confirms the number at verify.bmdc.org.bd
                  →  records number + mobile on Sign-up approvals
doctor registers  →  must match BOTH, or no account is created
                  →  fills in the profile form
                  →  status: verified  →  profile is live and bookable

doctor applies with a number nobody approved
                  →  status: pending  →  admin Doctor verification queue
```

This is implemented end-to-end — see `lib/bmdc.js`, `lib/repositories/doctor-approvals.ts`,
the **Sign-up approvals** and **Doctor verification** screens, and the **Join as a
doctor** form. A published profile is a real, non-demo entry in the same directory.

Two columns rather than one, because either alone is weak: a registration number
is public information printed on a nameplate, and a mobile number identifies a
handset rather than a clinician. Requiring both means whoever signs up holds the
phone the admin was told about *and* quotes the number the admin already checked.

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

1. An admin verifies each BM&DC number by hand and approves it with the doctor's
   mobile number (already built).
2. The approved doctor registers against that pair (already built).
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
│  │  ├─ admin-workspace.js      # overview, sign-up approvals, verification queue, directory
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
POST   /api/auth/verify-phone            send a six-digit SMS code to the account's mobile
PATCH  /api/auth/verify-phone            confirm that code
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
`lib/scheduling/engine.ts` is the algorithmic heart and the module the Testing
deliverable is built around. It is **pure** (no DB, no network), which is why it
can be tested exhaustively:

- `generateSlots(...)` — availability **rules − exceptions − booked − past/too-soon** → concrete slot times (UTC).
- `canBook(...)` — validates a booking request.
- `canCancel(...)` — enforces the cancellation window.
- `describeSlot(...)` — renders a UTC instant in Bangladesh Standard Time.

The 33 tests in `lib/scheduling/__tests__/engine.test.ts` cover slot generation,
buffers, exceptions overriding recurring rules, both sides of the cancellation
boundary, and a DST transition. Purity is what makes that affordable: none of
them needs a database.

Correctness under contention is a separate question and is tested separately,
against a real PostgreSQL server — see [Testing](#testing) below.

Both limitations noted during Phase 3 are now fixed. Appointments carry an
`end_utc` and overlap is enforced by a PostgreSQL exclusion constraint, so a
partial overlap between two different durations is representable and rejected.
And time conversion uses the IANA zone (`Asia/Dhaka`) rather than a hardcoded
UTC+6 offset, so a DST-style discontinuity cannot land an appointment an hour
out.

## Testing

```bash
npm test                  # 201 tests — unit + integration, in-process PostgreSQL
npm run test:concurrency  # 6 tests — needs a real server: docker compose up -d
npm run verify            # lint + typecheck + test + build
```

- [`docs/TESTING.md`](docs/TESTING.md) — how the suites are built, what testing
  found, and one defect it missed and why.
- [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) — every requirement mapped to
  the test that proves it, including the ones nothing proves.

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
`lib/ai/` works **without an API key**, using a transparent rule engine, and
upgrades to an LLM when any model credential is set. Safety properties:

- Red-flag symptoms (chest pain, stroke signs, self-harm, …) short-circuit to
  emergency advice **before** any model is consulted, and are never passed to one.
- No code path can downgrade an emergency result.
- LLM failures fall back to the rule engine — fail safe, never fail open. That
  includes every credential in the chain failing at once.
- Visit summaries are always returned `requiresReview: true`; the doctor edits and
  confirms before anything reaches a patient record.

### Connecting a model

Any provider speaking the OpenAI `/chat/completions` protocol works — there is
no vendor SDK. Google AI Studio issues a free key with no card and publishes an
OpenAI-compatible endpoint, which makes it the least friction.

Credentials are tried in order, and the first that answers serves the request:

```
GEMINI_API_KEY_1=<AI Studio key>      ─┐
GEMINI_API_KEY_2=<second key>          ├─ free tier, per-key daily quota
GEMINI_API_KEY_3=<third key>          ─┘
OPENAI_API_KEY=<OpenAI key>            └─ last resort; this one costs money
```

Three Gemini keys because a free quota is per key and per day, so one running
out mid-afternoon would otherwise take the assistant with it. A credential is
passed over when it reports a limit (429), is rejected, or cannot be reached,
and a key that reported a limit is rested rather than retried on every request.
Configure as many or as few as you like — unset ones are skipped, and one key
alone behaves exactly as before.

When *every* credential fails, triage keeps its rule-based answer and the visit
summary stays undrafted. There is no path from "no model answered" to a
clinical claim. See `lib/ai/providers.ts`.

The single-endpoint form (`AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL`) still works
and is tried last, so an existing configuration is unaffected.

```bash
npm run ai:check
```

Run that after setting the keys. It probes **every** credential separately,
which matters more with a chain than without one: if key 1 is dead the
assistant still works on key 2, and nothing on screen says so until the last
key goes too. Triage falls back to the rule engine whenever
the model is unreachable — correct clinically, but it means a wrong key is
indistinguishable from a working system until you look. `ai:check` calls the
provider with a benign non-clinical prompt and reports the status, the model
that answered, and whether JSON mode was honoured.

The model is a refinement layer, not the decision-maker: red flags short-circuit
before it is called, and it cannot downgrade an urgency the rules raised.

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

### Deploying the demonstration

A deployed instance is the practical way to run the consultation across two
devices: Vercel serves HTTPS, which is what the browser requires before it will
grant a page camera and microphone. Over plain `http://` on a LAN address it
will not, whatever the app does.

Four things are refused in production by default and have to be set on purpose,
because each one trades a real guarantee for convenience:

| Variable | Why it is needed | What it costs |
|---|---|---|
| `DATABASE_URL` | PGlite is refused; serverless functions do not share a filesystem anyway | — |
| `SESSION_SECRET`, `CRON_SECRET`, `NIRAMOY_ADMIN_CODE` | no defaulted secrets in production | — |
| `ALLOW_DEMO_PROFILES=true` | `db:seed` and `demo:live` refuse to write synthetic people into a production directory | the directory contains invented practitioners, badged **Demo profile** |
| `ALLOW_PUBLIC_VIDEO_ROOM=true` | credential-free Jitsi is refused in production | the room is unlisted, not access-controlled |

Then, from your machine, pointed at the deployed database:

```bash
export DATABASE_URL='postgresql://…'   # the same one Vercel uses
export ALLOW_DEMO_PROFILES=true
npm run db:migrate
npm run db:seed
npm run demo:live       # re-run shortly before you present
```

Set `APP_URL` to the deployment's own URL — the CSRF origin check enforces it
strictly once it is named. Vercel gives every preview deployment a different
hostname, so demonstrate from the production URL rather than a preview.

Both devices then sign in to the same deployment: one as
`nabila@example.com` (patient), one as `ayesha@example.com` (doctor), and each
presses Join call / Open room inside the join window.
