# Scaling

Reasoned, **not measured**. No load test has been run. Treat the numbers as
structure — where a bottleneck will appear — rather than as capacity planning.

## Assumptions

Modelled on Bangladesh telemedicine usage: consultations concentrate in the
evening (roughly 18:00–22:00 local), so peak is far above the daily mean.

| Users | Consultations/day | Peak requests/s | Where it hurts |
|---|---|---|---|
| 1,000 | ~50 | <5 | Nothing. PGlite would even cope in development |
| 100,000 | ~5,000 | ~150 | Connection pooling; the directory search |
| 1,000,000 | ~50,000 | ~1,500 | Database writes; AI inference cost; video minutes |

## Bottlenecks in order

**1. Connections.** The real serverless failure. Each instance holds its own
pool, so pool size multiplies across instances. Production caps at 3 per
instance; Neon's pooler or PgBouncer multiplexes above that. Getting this wrong
exhausts `max_connections` under exactly the load you wanted to serve.

**2. Directory search.** `ILIKE '%term%'` cannot use a B-tree. Indexed on the
filter columns today, which covers specialty and district. At scale, full-text
search over a `tsvector` with a GIN index; beyond that, a dedicated engine.

**3. AI inference.** The cost scales linearly with triage volume and is the only
per-request external cost. Mitigations already in place: the rule engine handles
emergencies without a model at all, and rate limits are tight (15 per 5 minutes).
Caching by input hash would help — the column exists.

**4. Video.** The dominant marginal cost at scale and the reason it is behind a
provider interface. Self-hosted Jitsi trades vendor cost for operational cost.
Not priced here; vendor pricing changes and inventing figures would be worse
than the gap.

**5. Appointment writes.** The advisory lock serialises per doctor, which is a
queue exactly where contention is real — one popular doctor's slots opening.
Different doctors never interact, so this scales with doctor count rather than
patient count, which is the right dimension.

**6. Audit and safety logs.** Append-only and write-heavy. Partition by month
before they get large; nothing queries across the whole history.

## What is already right

- Stateless application servers; nothing in memory is authoritative.
- Rate limits and job state in the database, not the process.
- Pagination capped at 60 per page.
- No N+1 in the list endpoints — prescription items are fetched in one query for
  all prescriptions, not one per prescription.
- Cron jobs are idempotent, so overlapping invocations under load are safe.

## What would need work

- No caching layer. Reference data (specialties, divisions, facilities) changes
  rarely and is fetched on every page load.
- No read replicas. The directory is read-heavy and would benefit.
- No queue. Notification delivery is inline; at scale it belongs in a worker.
- `audit_logs` and `safety_events` are unpartitioned.
