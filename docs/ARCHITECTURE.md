# Architecture

## Layering

```
route handler  →  authenticate  →  authorize  →  validate  →  service  →  repository  →  database
```

A route handler parses and responds. It never contains business logic, never
opens a transaction, and never writes SQL.

```
lib/
  api/            response envelope, route wrapper
  audit/          append-oriented audit log
  auth/           passwords, tokens, cookies, CSRF
  ai/             rules, schemas, triage, summaries
  config/         validated environment
  db/             schema, migrations, client, error classification, retry
  errors/         typed errors → HTTP status
  notifications/  providers + templates
  observability/  structured logging, redaction
  payments/       provider abstraction
  repositories/   the ONLY code that touches the database
  scheduling/     the pure engine
  security/       authorization, rate limiting, headers
  services/       business logic; transactions live here
  video/          provider abstraction
```

ESLint enforces the repository boundary: nothing outside `lib/repositories`,
`lib/services`, `lib/db` and the test harness may import the database client.

## Request flow

```mermaid
sequenceDiagram
    participant C as Client
    participant M as middleware
    participant R as route handler
    participant A as authz
    participant S as service
    participant P as repository
    participant D as PostgreSQL

    C->>M: request + session cookie
    M->>R: + security headers, request id
    R->>A: requireUser / requireRole / requirePatient
    A->>P: resolve session
    P->>D: SELECT … WHERE token_hash = … AND status = 'active'
    A-->>R: Principal (subject comes from HERE, never the request)
    R->>R: validate body
    R->>S: service call
    S->>P: repository call
    P->>D: SQL
    D-->>P: rows / constraint violation
    P-->>S: typed result / classified error
    S-->>R: domain result
    R-->>C: { ok, … } or { ok: false, error: { code, message } }
```

## Booking

The property this platform lives or dies on.

```mermaid
flowchart TD
    A[POST /api/appointments] --> B[requirePatient]
    B --> C[generate slots — ADVISORY]
    C --> D{requested slot free?}
    D -->|no| E[409 with a specific reason]
    D -->|yes| F[BEGIN]
    F --> G[pg_advisory_xact_lock on the doctor]
    G --> H[INSERT appointment]
    H --> I{exclusion constraint}
    I -->|23P01| J[409 APPOINTMENT_CONFLICT]
    I -->|ok| K[COMMIT]
    K --> L[status history, notification, audit]
```

The pre-flight check is advisory; **the database is authoritative**. Between
generating slots and writing, another request can take the slot — so we attempt
the insert and let the constraint decide. A `23P01` is the expected outcome of a
lost race, not an exception.

The advisory lock is about liveness, not correctness. Concurrent inserts against
an exclusion constraint deadlock under contention, persistently enough that
retrying does not clear it. Serialising per doctor turns a lock cycle into a
queue. If the lock were removed, bookings would still be **correct** — just
failure-prone. Safety first, liveness on top.

## AI triage

```mermaid
flowchart TD
    A[patient text] --> B[Layer 1: deterministic rules]
    B --> C{red flag?}
    C -->|yes| D[emergency advice<br/>text NEVER sent to a model]
    C -->|no| E{LLM configured?}
    E -->|no| F[rule result]
    E -->|yes| G[Layer 2: LLM call]
    G --> H[Layer 3: schema validation]
    H -->|invalid| F
    H -->|valid| I[Layer 4: urgency floor]
    I --> J{model proposed milder?}
    J -->|yes| K[blocked — rules stand<br/>safety event recorded]
    J -->|no| L[model result]
    F --> M[Layer 5: routes to a doctor]
    L --> M
    K --> M
```

The emergency path never involves a model. Not "the model is told not to
downgrade" — the text is never transmitted, so no prompt-injection payload can
defeat a request that was never made.

## Doctor verification

```mermaid
flowchart LR
    A[doctor registers] --> B[submits BM&DC number]
    B --> C{BMDC_API_URL set?}
    C -->|no| D[status: pending]
    C -->|yes| E[call registry]
    E -->|unreachable| D
    E -->|valid| F[status: verified]
    D --> G[admin checks verify.bmdc.org.bd by hand]
    G -->|confirmed| F
    G -->|not confirmed| H[status: rejected]
    F --> I[profile published and bookable]
```

Pull, not push. There is no path from *submitted* to *verified* that does not
pass through a real registry response or a named human. It never fails open, and
no captcha is solved to get there.

## Data model

See [`DATABASE.md`](DATABASE.md). Twenty-eight tables; the ones that carry the
guarantees are `appointments` (exclusion constraint), `medical_records`
(immutable content, amendment chain), `ai_triage_sessions` (urgency floor) and
`audit_logs` (append-only trigger).

## Serverless shape

- The database client is cached on `globalThis`, so a warm invocation reuses it.
- Connection pools are small (3 in production): pool size multiplies across
  instances, and a large per-instance pool exhausts the server.
- No in-process state is authoritative — not sessions, not rate limits, not job
  state. Each invocation has its own memory, so anything kept there is wrong at
  the moment it matters.
- The Neon HTTP driver is used when the connection string points at Neon: no
  socket to keep warm.

## Timezones

Instants are stored in UTC. Availability is stored as a **local window plus its
IANA zone**, and converted by the engine via `Intl`. Nothing hardcodes UTC+6 —
the prototype did, which also produced a negative hour for any clinic starting
before 06:00 local.
