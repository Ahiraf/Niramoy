# Authorization

## The rule

**The subject of a request comes from the session, never from the request.**

There is no parameter a caller can send that changes whose data they receive.
`?patientId=`, `?userId=` and body-supplied ids are ignored, not preferred.

## Helpers

| Helper | Guarantees |
|---|---|
| `getPrincipal(request)` | The caller or `null`. Enforces CSRF on unsafe methods. |
| `requireUser(request)` | Authenticated, else 401. |
| `requireRole(request, …roles)` | Holds one of the roles, else 403. |
| `requirePatient(request)` | A patient **with** a resolved `patientId`. |
| `requireAdmin` / `requireDoctor` | Shorthands. |
| `assertOwnership(principal, ownerId, ctx)` | Owner id must come from the database. |
| `assertPatientOwnership(...)` | The same, keyed on clinical identity. |

## Matrix

| Resource | Patient | Doctor | Admin |
|---|---|---|---|
| Own records | read, append | — | — |
| Another patient's records | ✗ | ✗ (see below) | ✗ |
| Prescriptions | read own | create for own completed consultations | ✗ |
| Appointments | own, and ones they booked | own clinic | ✗ |
| Cancel / reschedule | own, inside the window | own clinic, any time | ✗ |
| Complete a consultation | ✗ | own clinic | ✗ |
| Video join token | own consultation | own consultation | ✗ |
| Reviews | one per own completed appointment | ✗ | moderate |
| Family | own household | ✗ | ✗ |
| Verification queue | ✗ | submit own | read, decide |
| Doctor suspension | ✗ | ✗ | ✓ (reason required) |
| Audit log | ✗ | ✗ | read only |
| AI triage | ✓ | ✓ | ✓ |
| AI summary draft | ✗ | own consultations | ✗ |
| Approve a summary | ✗ | own drafts | ✗ |

## Why admins get no override

An admin has no clinical reason to read a patient's record. Granting the role a
universal skeleton key is how "authorized" quietly stops meaning anything, and
it makes a compromised admin account catastrophic rather than merely bad.

Admin powers are granted endpoint by endpoint. There is a test asserting an
admin cannot obtain a video join token: administrative authority does not extend
to sitting in on a consultation.

## Doctor access to patient data

Holding a doctor account is not authority over a patient. The **treatment
relationship** grants it, and here that is an appointment between this doctor and
this patient. A doctor with no appointment for a patient cannot prescribe for
them, draft a summary about them, or join a room with them.

This is also what limits the blast radius of a compromised doctor account: it
reaches that doctor's own patients, not the platform's.

## 404 versus 403

Where a row's existence is itself information, a non-participant gets **404**.
A doctor probing appointment ids should not learn which exist. Where the
resource is public knowledge and only the action is restricted — the admin
queue, for instance — 403 is correct and clearer.

## Family accounts

Being someone's family is not permission to read their medical history. Each
member carries an explicit `access_level`, defaulting to `appointments_only`,
with consent timestamps. A dependent gets their own clinical identity, so their
records are theirs and survive being removed from the household.

The consent model needs legal review before production —
`REGULATORY_ASSUMPTIONS.md` A1.
