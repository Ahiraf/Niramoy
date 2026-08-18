# Niramoy — নিরাময়

An **AI-assisted serverless telemedicine & appointment platform** for Bangladesh.
CSE-356 (Software Engineering Sessional) project — CUET.

Patients discover verified doctors, book conflict-free appointment slots, consult
over video, and keep a digital record of prescriptions and history. An AI layer
adds symptom triage, doctor recommendation, and automated visit summaries.

## Tech stack
- **Next.js** (React, App Router) — UI + serverless API routes
- **Vercel Postgres (Neon)** — single source of truth; double-booking prevented
  by a DB `UNIQUE (doctor_id, start_utc)` constraint + transactions
- **NextAuth** — role-based auth (patient / doctor / admin)
- **Vercel Cron** — appointment reminders + no-show sweep
- **Jitsi / Daily** — embedded video consultation
- **Gemma / OpenAI** — AI triage, recommendation, visit summaries

## Project layout
```
Niramoy/
├─ lib/
│  ├─ scheduling.js          # ★ the scheduling engine (pure, testable) — the core
│  └─ __tests__/
│     └─ scheduling.test.js  # requirements-based unit tests (grade centerpiece)
├─ db/
│  └─ schema.sql             # PostgreSQL schema (UTC everywhere)
├─ app/                      # Next.js routes (to be built in Development week)
├─ .env.example
├─ jest.config.js
└─ package.json
```

## Getting started
```bash
cd Niramoy
npm install
npm test          # run the scheduling engine test suite
npm run dev       # start the Next.js dev server (once app/ is built out)
```

## The scheduling engine (start here)
`lib/scheduling.js` is the algorithmic heart and the module the Testing
deliverable is built around. It is intentionally **pure** (no DB, no network):

- `generateSlots(...)` — turns availability **rules − exceptions − booked −
  past/too-soon** into concrete bookable slot times (UTC).
- `canBook(...)` — validates a booking request (past, too-soon, unavailable).
- `canCancel(...)` — enforces the cancellation window.

The tests in `lib/__tests__/scheduling.test.js` cover double-booking,
past/too-soon slots, boundary slots, buffer time, exceptions overriding
recurring rules, and the cancellation window — these map 1:1 to the
requirements-based test table in your report.

## Development roadmap (MVP)
1. Auth + roles (NextAuth)
2. Doctor availability UI → `availability_rules` / `availability_exceptions`
3. Patient booking flow → transactional insert into `appointments`
4. Embedded video room per appointment
5. Prescriptions + medical history
6. Cron reminders + no-show sweep
7. AI: symptom triage → doctor recommendation → visit summary

## Deploy
Push to GitHub → import into Vercel → add a Vercel Postgres store → set the
env vars from `.env.example`. Vercel gives you a live URL for the viva demo.
