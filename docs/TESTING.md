# Testing

```bash
npm test                  # unit + integration (in-process PostgreSQL)
npm run test:concurrency  # needs a real server — docker compose up -d
npm run verify            # lint + typecheck + test + build
```

## Counts

| Suite | Tests | What it covers |
|---|---|---|
| `lib/db/__tests__/constraints` | 21 | Schema guarantees, with no application code in the way |
| `lib/scheduling/__tests__/engine` | 33 | The pure engine: boundaries, buffers, exceptions, timezones |
| `lib/ai/__tests__/triage` | 55 | Vignettes, validation, injection, the urgency floor |
| `test/__tests__/security` | 44 | Every case in brief §61, plus video authorization |
| `test/__tests__/jobs` | 11 | Idempotency of every scheduled job |
| `test/__tests__/ai-workflow` | 14 | Persistence, provenance, the summary approval path |
| `test/__tests__/payments` | 13 | Webhook verification, idempotency, amount integrity |
| `test/__tests__/booking.concurrency` | 6 | **Requires a real server** |

## Why integration tests use a real database

PGlite is PostgreSQL compiled to WASM, so CHECK constraints, triggers and
`btree_gist` behave exactly as they do on a server. Tests run the real route
handlers with real `Request` objects against it.

Nothing is mocked. The properties under test — "is this query scoped to the
session?" — live in the SQL and the authorization helpers. A test that mocked
the repository would be asserting about the mock.

## Why concurrency tests need a real server

PGlite is single-connection: it serialises everything, so it would pass the
concurrency suite without proving anything. A test that cannot fail is worse
than no test, so the suite **skips loudly** with an explanatory message rather
than pretending.

That suite is what found the deadlock: twelve simultaneous overlapping inserts
deadlocked persistently, and four retries did not clear it. The fix was a
per-doctor advisory lock. Running against the in-process database, this would
never have been discovered.

## What testing found

Each of these was a real defect, caught by writing the test rather than by
reading the code:

1. **Persistent deadlock** under concurrent overlapping inserts — led to the
   advisory lock.
2. **Two red-flag coverage gaps** — "face **is** drooping" and "throat **is**
   closing" did not match patterns written without the intervening word.
3. **Drizzle wraps driver errors**, so SQLSTATE and constraint names are on
   `cause`. Reading the top-level message turned an expected 409 into a 500.
4. **A partial test fixture** seeded two specialties, so triage routing to a
   third silently lost provenance rows.

## Not implemented

**End-to-end browser tests.** `npm run test:e2e` is wired for Playwright and
`docs/IMPLEMENTATION_PLAN.md` names the two journeys, but no specs are written.
The journeys are exercised at the API level instead, which covers the logic and
not the rendering. This is an honest gap, not a claim.

**Load testing.** Scaling assumptions in `SCALING.md` are reasoned, not measured.
