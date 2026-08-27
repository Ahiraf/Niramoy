# Security

## Threat model

The asset worth protecting is patient data — records, prescriptions,
consultation history, and the fact that a given person consulted a given doctor
at all. The realistic adversaries are an unauthenticated internet attacker, a
legitimate user reaching for data that is not theirs, and a compromised account.

Everything below is implemented and covered by `test/__tests__/security.test.ts`,
which runs the real handlers against a real database.

## What was wrong, and what fixed it

The prototype's central flaw was that **the subject of a request came from the
request**. Every patient-scoped route resolved it as
`query.patientId ?? patientIdFor(request)` — preferring a client-supplied id over
the session, and falling back to a hardcoded demo patient when signed out.

| Finding | Was | Now |
|---|---|---|
| S1 | `?patientId=` returned any patient's data | The parameter is ignored; the subject is `requirePatient(request).patientId` |
| S2 | Signed-out callers were served the demo patient's records | 401 |
| S3 | Any caller could `POST /api/prescriptions`, and `POST /api/records` accepted `kind: "prescription"` | Doctor role **and** a treatment relationship; the back door is refused explicitly |
| S4 | Appointments were cancelled, rescheduled and completed by id, unchecked | Every action loads the row and confirms participation first |
| S5 | Reviews needed only a non-duplicate appointment id | Appointment must exist, belong to the reviewer, and be completed |
| S6 | `DELETE ?id=` removed any family member or waitlist entry | Scoped to the owner's household / patient identity |
| S7 | `GET /api/doctors/:id` returned `bmdcNumber` | Public queries list columns explicitly; the number is admin-only |
| S8 | No CSRF protection | Origin check plus a double-submit token bound to the session |
| S9 | No verification, reset, rotation, lockout or rate limiting | All implemented |
| S10 | AI endpoints unauthenticated and unbounded | Rate limited, length capped, summary generation doctor-only |

## Authentication

Argon2id (19 MiB, t=2, p=1) for new passwords. scrypt is retained as a verifier
so prototype hashes keep working and upgrade transparently on next sign-in.

Hashing is capped at 1 KiB of input: Argon2 work is linear in length and the
attacker controls it.

Sessions are server-side rows. Only a SHA-256 hash of the token is stored, so a
database leak yields no live sessions. Every lookup joins the user and requires
`status = 'active'`, so suspending an account kills its sessions immediately
rather than at expiry. Tokens rotate on every privilege change — sign-in,
password change, password reset — which is what closes session fixation.

## Enumeration resistance

Not just the response body. A login against an unknown email still performs a
full Argon2 verification against a dummy hash, because response time is the leak
people forget. A locked account returns `BAD_CREDENTIALS` rather than announcing
the lockout. Password reset returns an identical message and does identical work
whether or not the address exists; the only difference is whether an email is
sent, which is visible to the mailbox owner and nobody else.

Sign-up is the deliberate exception: an address is either available or it is not.

## Authorization

`assertOwnership` takes the owner id **already read from the database**, so a
caller cannot supply the value that authorizes them.

Admins get no blanket override. An admin has no clinical reason to read a
patient's record, and a universal skeleton key is how "authorized" stops meaning
anything. Admin powers are granted endpoint by endpoint, and there is a test
asserting an admin cannot obtain a video join token.

Where a row's existence is itself information, a non-participant gets 404 rather
than 403, so ids cannot be probed.

## CSRF

Two independent checks on every unsafe method: `Origin`/`Referer` must match
`APP_URL`, and the readable `niramoy_csrf` cookie must equal the
`x-niramoy-csrf` header **and** the secret stored on the session row.

`SameSite=Lax` rather than `Strict`: Strict drops the session cookie on inbound
navigation, so a patient following an appointment reminder from their email
would land signed out. Lax still blocks cross-site POSTs.

## Rate limiting

Durable and shared — Postgres counters by default, Upstash Redis optionally.
Process memory is not an option: each serverless invocation has its own, so an
in-process limit of N per minute actually permits N × instance count, loosening
exactly when traffic spikes.

The limiter **fails open** when its store is unreachable. It exists to protect
availability; letting its own outage take the application down inverts the
point. Authentication and authorization do not depend on it.

## Audit logging

Append-only at the database — a trigger rejects `UPDATE` and `DELETE`, so
"we tidied up the audit trail" is not something the application can do.

Rows record actors, resource ids, outcomes and counts. Never a symptom
description, a diagnosis, a prescription line, a password or a token.
`metadata` is passed through the logger's redactor on the way in, so a careless
caller cannot smuggle PHI into it.

## Content Security Policy

`connect-src` matters as much as `script-src` here: a health application's worst
XSS outcome is not a defaced page, it is a script reading a patient's records
and posting them elsewhere.

The video provider gets a scoped exception in `frame-src`, `connect-src` and
`Permissions-Policy`, naming the configured provider's origins rather than a
wildcard. With no provider configured, camera and microphone are denied outright.

**Known weakening:** `script-src` includes `'unsafe-inline'`, required by Next's
hydration bootstrap. Removing it means adopting nonces throughout. Recorded here
rather than left looking deliberate.

## Known gaps

- File upload is designed (private storage keys, no public buckets) but no
  upload endpoint is implemented; scope was not expanded to it.
- No account-recovery flow for a lost second factor, because there is no second
  factor. MFA is not implemented.
- `'unsafe-inline'` in `script-src`, above.
- Penetration testing has not been performed.
