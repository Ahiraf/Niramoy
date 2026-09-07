# Final implementation report

Turning the Niramoy frontend prototype into a full-stack application, across ten
phases on branch `backend-foundation`.

**Headline: the platform is internally coherent and well-tested, and it is NOT
safe for real patients.** Section 11 says exactly why.

---

## 1. What was implemented

| Phase | Delivered |
|---|---|
| 1 Foundation | TypeScript, ESLint, validated env, Drizzle, 28-table schema, migrations, seed, typed errors, redacting logger, health endpoints |
| 2 Auth | Argon2id, DB sessions with rotation, email verification, password reset, CSRF, RBAC — **findings S1–S6, S9 closed** |
| 3 Doctors | Profiles, specialties, availability, BM&DC verification with the full status set, admin decisions, suspension |
| 4 Scheduling | `end_utc`, exclusion constraint, transactional booking, atomic reschedule, waitlist with expiring holds, **per-doctor advisory lock** |
| 5 Medical data | Append-only records with amendments, doctor-only prescriptions, family accounts with consent, eligibility-gated reviews |
| 6 Video | Provider interface (Daily/Jitsi/demo), server-side rooms, scoped expiring tokens, recording off at every layer |
| 7 Notifications & cron | Email providers, five idempotent jobs, authenticated cron endpoints |
| 8 AI safety | Versioned rules, working Bangla/Banglish, schema-validated output, urgency floor, draft→review→confirm, safety events |
| 9 Payments | Provider interface, labelled mock, verified webhooks, replay protection, idempotency |
| 10 Hardening | Rate limiting, CSP and security headers, audit log, admin dashboard, CI, documentation |

**191 tests pass** (+6 concurrency against real PostgreSQL). Lint, typecheck and
build clean.

---

## 2. What of the frontend was preserved

Essentially all of it. The prototype was **not** mock-driven — components already
called real API routes through one client — so the work was behind the HTTP
boundary.

**Unchanged:** `globals.css` (831 lines, the whole design system), `landing.js`,
`shell.js`, `ui.js`, `icons.js`, `settings.js`, `join-as-doctor.js`,
`admin-workspace.js`, and every file under `patient/` except one section of
`appointments.js`.

**Changed, minimally:**

| File | Change |
|---|---|
| `app/lib/api.js` | CSRF token handling, `credentials: same-origin`, new endpoints |
| `app/page.js` | Join call fetches a server token; prescription submit confirms the AI draft |
| `patient/appointments.js` | The video placeholder now reports the real provider state |
| `doctor-workspace.js` | Summary draft carries an appointment id and a draft id |
| `auth-page.js`, `landing.js` | Four lint fixes; no visual change |

No component was rewritten. No layout, colour, spacing or copy was altered
except where the copy had become untrue.

---

## 3. Database

PostgreSQL via Drizzle. Three drivers — Neon HTTP, node-postgres, and in-process
PGlite so the project runs on a clean checkout with no infrastructure.

`uuid` primary keys throughout. All instants UTC; availability stored as a local
window plus an IANA zone.

**The guarantee that matters:**

```sql
EXCLUDE USING gist (doctor_id WITH =, tstzrange(start_utc, end_utc, '[)') WITH &&)
  WHERE (status NOT IN ('cancelled','no_show'))
```

`UNIQUE (doctor_id, start_utc)` is kept but is **not sufficient** — 10:00–10:30
and 10:15–10:45 share no start time. Adding `end_utc` was required; the prototype
stored only a start, which made the overlap case unrepresentable.

Rules pinned in the schema rather than only in code: AI summaries cannot claim to
need no review; triage urgency cannot be stored below the rules'; red-flagged
sessions cannot have reached a model; a verified doctor must have evidence; a
demo profile cannot carry a registration number; a non-mock payment cannot be
`succeeded` without a verified webhook. `audit_logs`, `appointment_status_history`
and `safety_events` reject UPDATE and DELETE; `medical_records` freezes content.

---

## 4. Authentication and authorization

Argon2id (scrypt retained as a verifier, upgraded on next sign-in). Sessions are
DB rows storing only a token hash, rotated on every privilege change.

Enumeration resistance covers timing, not just wording: an unknown email still
costs a full Argon2 verification.

**The core fix:** the subject of a request comes from the session, never the
request. `?patientId=` is ignored, not preferred.

Admins get no blanket override — including no video join token.

---

## 5. Scheduling and concurrency

The pre-flight check is advisory; the database is authoritative.

Writing the concurrency suite found a real defect: twelve simultaneous
overlapping inserts **deadlocked persistently**, and four retries did not clear
it — the burst spent 19 seconds failing. A per-doctor `pg_advisory_xact_lock`
turns the lock cycle into a queue; the same burst now completes in 348 ms.

The layering is deliberate: the constraint guarantees **correctness**, the lock
provides **liveness**. Remove the lock and bookings stay correct, just
failure-prone.

Reschedule is a single UPDATE. The prototype cancelled and re-created, losing the
appointment entirely on a mid-sequence crash and detaching linked prescriptions.

---

## 6. Doctor verification

Pull, not push. No path from *submitted* to *verified* bypasses a real registry
response or a named human. Never fails open. **No captcha is solved and the
register is not scraped** — it is an access control, and harvesting it would
violate its terms and the privacy of practitioners who never agreed to be listed.

---

## 7. AI safety

Two invariants:

- **An emergency never reaches a model.** The text is never transmitted, so no
  injection payload can defeat a request that was never made.
- **The model can raise urgency, never lower it.** Enforced in the service, by a
  CHECK constraint, and by a test.

Bangla now actually works. The prototype used `\b` word boundaries, which never
match inside Bangla script — **no Bangla pattern could ever have fired**.

With no API key configured (the default), **no patient text leaves the system**.
Triage retains a hash, a length and a language — not the description.

---

## 8. Security controls

Rate limiting (durable, fails open by design), CSP with `connect-src` scoped so
an XSS cannot exfiltrate, video-provider origins named rather than wildcarded,
camera and microphone denied when no provider is configured, HSTS in production,
append-only audit log carrying no PHI.

---

## 9. Testing

| Suite | Tests |
|---|---|
| Schema constraints | 21 |
| Scheduling engine | 33 |
| AI triage vignettes | 55 |
| Security (§61, CSRF, video) | 46 |
| Cron idempotency | 11 |
| AI workflow | 14 |
| Payments | 21 |
| **`npm test` total** | **201** |
| **Concurrency (real PostgreSQL)** | 6 |

Four real defects were found by writing tests: the deadlock, two red-flag
coverage gaps, Drizzle's error wrapping turning 409s into 500s, and a partial
fixture silently losing provenance rows.

A fifth reached a human tester instead — the CSRF origin check rejecting every
write when the app was served anywhere but `localhost:3000` — because every test
built requests with no `Host` header and so never varied the one dimension the
bug lived in. See [TESTING.md](TESTING.md), *What testing missed, and why*.

Requirement-by-requirement coverage, including the nine requirements nothing
proves, is in [TRACEABILITY.md](TRACEABILITY.md).

---

## 10. Definition of Done (brief §60)

✅ Frontend connected · PostgreSQL · migrations · authentication · sessions ·
RBAC · verification workflow · only verified doctors bookable · scheduling engine
· concurrency tested · overlaps prevented · cancel/reschedule · records protected
· prescriptions protected · family accounts · reviews · waitlist · video
abstraction · video authorized · AI rule engine · emergency short-circuit · LLM
output validated · AI cannot prescribe · summaries need approval · Bangla/Banglish
· AI rate limits · audit logging · notifications · cron · payment abstraction ·
admin dashboard · security tests · IDOR tests · AI safety tests · CI · production
build · documentation · no secrets · `.env.example`

❌ **E2E tests** — `npm run test:e2e` is wired for Playwright and the journeys are
named, but **no specs are written**. The journeys are covered at the API level,
which tests the logic and not the rendering.

❌ **Load testing** — `SCALING.md` is reasoned, not measured.

---

## 11. Status by category

### WORKING
Auth, sessions, CSRF, RBAC, directory, availability, booking, cancel,
reschedule, waitlist, records, prescriptions, family, reviews, notifications,
cron, AI triage (rules), summary workflow, verification, admin dashboard, audit,
rate limiting, security headers.

### DEMO-ONLY
144 synthetic doctors (badged, no registration numbers, refused in production);
the mock payment provider; the demo video provider; console email.

### REQUIRES AN EXTERNAL PROVIDER
Real video (Daily/Jitsi), email delivery (Resend), LLM triage and summaries,
bKash/Nagad, Redis rate limiting, BM&DC API.

### REQUIRES LEGAL / CLINICAL REVIEW
Record retention (A1) · medical-device classification (A2) · remote prescribing
(A3) · cross-border PHI transfer (A4) · payment authorisation (A7) ·
e-prescription validity (A8) · **the red-flag rule set (A9 — clinical, not
legal)**.

### NOT SAFE FOR REAL PATIENTS
1. **The AI rule set has never been seen by a clinician.** Triage sensitivity for
   emergent conditions is unmeasured. This is the single largest gap.
2. Bangladesh's disease burden is under-covered — dengue, typhoid and
   tuberculosis are only partially represented.
3. No drug-interaction or allergy checking.
4. No MFA.
5. `'unsafe-inline'` remains in `script-src` (Next hydration).
6. No penetration test.
7. No E2E coverage of the rendered UI.

---

## 12. Remaining production blockers

**Must fix**

1. Clinical review of the red-flag rule set, with a clinician-labelled vignette
   set and a measured sensitivity target.
2. Legal review of A1–A9.
3. Penetration test.
4. Load test to validate the assumptions in `SCALING.md`.

**Should fix**

5. E2E specs for the two journeys.
6. CSP nonces to remove `'unsafe-inline'`.
7. MFA for doctor and admin accounts.
8. Partition `audit_logs` and `safety_events`.
9. Upgrade Next 15 → 16 (transitive advisories; deferred as a breaking change).

**Nice to have**

10. Read replicas and a cache for reference data.
11. Notification delivery moved to a queue.
12. OpenAPI generated from the Zod schemas.

---

## 13. Honest summary

The engineering is sound. The database refuses to store an unsafe appointment, an
unreviewed AI summary, a downgraded emergency, a fabricated registration number,
or an unverified payment marked successful. Authorization is enforced from the
session everywhere and tested against every attack the brief enumerates.

None of that makes it clinically safe. A triage system whose rules no doctor has
read is not ready for patients, however well-constructed the code around it is —
and the code around it is the part I can vouch for.
