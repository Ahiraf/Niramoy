# API

All responses share an envelope:

```json
{ "ok": true,  "…": "payload" }
{ "ok": false, "error": { "code": "APPOINTMENT_CONFLICT", "message": "…" },
  "reason": "slot_taken", "message": "…" }
```

`error.code` is the contract. `reason` and `message` are legacy fields the
existing components read, and are removed once the frontend has migrated.

Unsafe methods (`POST`, `PATCH`, `DELETE`) require the `x-niramoy-csrf` header
matching the `niramoy_csrf` cookie. `app/lib/api.js` handles this.

## Codes

| Code | Status | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Field errors in `error.details` |
| `INPUT_TOO_LARGE` | 413 | Body or field over the cap |
| `UNAUTHENTICATED` | 401 | No usable session |
| `BAD_CREDENTIALS` | 401 | Wrong password, unknown account, or locked — indistinguishable by design |
| `FORBIDDEN` | 403 | Authenticated but not permitted |
| `WRONG_ROLE` | 403 | Account exists under a different role |
| `NOT_VERIFIED` | 403 | Doctor not yet BM&DC-verified |
| `CSRF_FAILED` | 403 | Origin or token check failed |
| `NOT_FOUND` | 404 | Absent, or not yours — deliberately the same |
| `APPOINTMENT_CONFLICT` | 409 | The slot overlaps an existing appointment |
| `ALREADY_REVIEWED` | 409 | One review per appointment |
| `BMDC_INVALID` | 422 | Malformed registration number |
| `CANCEL_WINDOW_CLOSED` | 422 | Too close to the appointment |
| `NOT_ELIGIBLE` | 422 | State does not permit the action |
| `RATE_LIMITED` | 429 | With `Retry-After` |
| `PROVIDER_UNAVAILABLE` | 503 | External provider down or not connected |

## Endpoints

Auth — `role: —` means no session required.

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/auth` | — | `{ user: null }` when signed out; never 401 |
| PATCH | `/api/auth` | any | Own profile. Role and verification status are not writable |
| DELETE | `/api/auth` | any | Revokes the session server-side |
| POST | `/api/auth/login` | — | Rate limited by IP and email |
| POST | `/api/auth/register` | — | Doctors may include `bmdcNumber` for a shape check |
| PATCH | `/api/auth/password` | any | Requires the current password; revokes other sessions |
| POST | `/api/auth/password-reset` | — | Identical response whether or not the account exists |
| PATCH | `/api/auth/password-reset` | — | Consumes the token, signs in on a fresh session |
| POST | `/api/auth/verify-email` | — | Consumes a verification token |

Directory — public.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/reference` | Specialties, divisions, facilities, coverage stats |
| GET | `/api/doctors` | `search, specialty, division, district, language, maxFee, minRating, sort, page, perPage`. Verified only |
| GET | `/api/doctors/:id` | Profile plus published reviews. Never includes the registration number |
| GET | `/api/doctors/:id/slots` | `days` (max 60). **Advisory** — the constraint decides at booking |

Appointments.

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/appointments` | patient, doctor | Scoped to the session; no id parameters |
| POST | `/api/appointments` | patient | Transactional. 409 on overlap. `forMemberId` books for a dependent |
| PATCH | `/api/appointments/:id` | participant | `action: cancel \| reschedule \| complete` |
| POST | `/api/appointments/:id/video` | participant | Short-lived join token. Not GET: it mints a credential |

Clinical.

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/records` | patient | Own history. Audited |
| POST | `/api/records` | patient | Own notes. `kind: "prescription"` is refused |
| GET | `/api/prescriptions` | patient | Own |
| POST | `/api/prescriptions` | doctor | Requires a treatment relationship and a completed consultation |
| GET/POST/DELETE | `/api/family` | patient | Own household |
| GET/POST/DELETE | `/api/waitlist` | patient | Own entries |
| GET | `/api/reviews?doctorId=` | — | Published reviews |
| POST | `/api/reviews` | patient | Needs an eligible completed appointment |
| GET/POST | `/api/notifications` | any | Own; POST marks read |

AI.

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/api/ai/triage` | optional | Rate limited. 4000-char cap. Emergencies return no booking matches |
| POST | `/api/ai/summary` | doctor | Own consultation. Always `requiresReview: true` |
| PATCH | `/api/ai/summary/:id` | doctor | `action: approve \| reject`. The only path to the record |

Verification, admin, payments, ops.

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/verification` | admin | The queue |
| POST | `/api/verification` | doctor | Apply. Never auto-approves without a registry response |
| PATCH | `/api/verification` | admin | Approve or reject |
| GET | `/api/admin/overview` | admin | Aggregates only |
| GET/PATCH | `/api/admin/doctors` | admin | Suspend and reinstate; a reason is required |
| GET | `/api/admin/audit` | admin | Read-only by construction |
| POST | `/api/payments` | patient | Amount comes from the appointment, not the body |
| POST | `/api/payments/webhook` | — | Signature-verified. Not session-authenticated: the caller is a gateway |
| POST | `/api/cron/:job` | — | `Authorization: Bearer $CRON_SECRET`, constant-time |
| GET | `/api/health` | — | Liveness. Does not touch the database |
| GET | `/api/ready` | — | Readiness. 503 when the database is unreachable |

## OpenAPI

Not generated. The table above is the specification. Adding
`@asteasolutions/zod-to-openapi` over the existing Zod schemas would produce one,
and is a reasonable next step rather than something claimed here.
