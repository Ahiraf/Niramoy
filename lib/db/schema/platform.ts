/**
 * Niramoy — notifications, payments, audit and rate limiting
 */

import { sql } from "drizzle-orm";
import {
  index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

import { appointments } from "./scheduling";
import { patients, users } from "./identity";
import {
  auditOutcome, notificationChannel, notificationStatus, paymentStatus, userRole,
} from "./enums";

/**
 * Notifications. `dedupeKey` is what makes the reminder and no-show cron jobs
 * idempotent (brief §24): the job computes a deterministic key, and a second run
 * conflicts on the unique index instead of sending a second message.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: notificationChannel("channel").notNull().default("in_app"),
    type: text("type").notNull(),

    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Navigation hints only (ids, routes). Never clinical content. */
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),

    status: notificationStatus("status").notNull().default("pending"),
    /** e.g. "reminder:<appointmentId>:24h". Unique, so a re-run is a no-op. */
    dedupeKey: text("dedupe_key"),

    sentAt: timestamp("sent_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    attemptCount: integer("attempt_count").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_notifications_dedupe").on(t.dedupeKey),
    index("idx_notifications_user_created").on(t.userId, t.createdAt),
    index("idx_notifications_unread").on(t.userId, t.readAt),
    index("idx_notifications_pending").on(t.status, t.createdAt),
  ],
);

/**
 * Payments. The default provider is a clearly-labelled mock (brief §25). No card
 * data is ever stored — only the provider's own reference. A payment is
 * `succeeded` because a verified webhook said so, never because a browser did.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    patientId: uuid("patient_id").references(() => patients.id, { onDelete: "set null" }),
    payerUserId: uuid("payer_user_id").references(() => users.id, { onDelete: "set null" }),

    provider: text("provider").notNull(),
    /** True for the MockPaymentProvider. Surfaced in the UI; nothing is charged. */
    isMock: text("is_mock").notNull().default("true"),
    providerPaymentId: text("provider_payment_id"),

    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("BDT"),
    status: paymentStatus("status").notNull().default("pending"),

    /** Client-supplied, enforced unique: a retried request cannot double-charge. */
    idempotencyKey: text("idempotency_key").notNull(),
    /** Set only after a signature check passes. Null means "not trusted yet". */
    webhookVerifiedAt: timestamp("webhook_verified_at", { withTimezone: true }),
    providerStatusRaw: text("provider_status_raw"),
    failureReason: text("failure_reason"),

    refundedAmount: numeric("refunded_amount", { precision: 10, scale: 2 }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_payments_idempotency").on(t.idempotencyKey),
    uniqueIndex("uq_payments_provider_ref").on(t.provider, t.providerPaymentId),
    index("idx_payments_appointment").on(t.appointmentId),
  ],
);

/** Replay protection for provider webhooks. A repeated event id is ignored. */
export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
    signatureVerified: text("signature_verified").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("uq_webhook_provider_event").on(t.provider, t.providerEventId)],
);

/**
 * The audit log (brief §22). Append-only: a trigger in the migration rejects
 * UPDATE and DELETE on this table, so "we cleaned up the audit trail" is not
 * something the application can do by accident.
 *
 * It records THAT something happened, not WHAT was in it. There is no PHI here:
 * `metadata` carries identifiers, counts and outcomes only.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),

    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorRole: userRole("actor_role"),
    /** Hashed with the session secret. Never a raw address. */
    actorIpHash: text("actor_ip_hash"),
    requestId: text("request_id"),

    /** Dotted verb, e.g. "record.read", "verification.approve", "auth.login". */
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    /** The person the action was about, when that differs from the actor. */
    subjectUserId: uuid("subject_user_id").references(() => users.id, { onDelete: "set null" }),

    outcome: auditOutcome("outcome").notNull().default("success"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    index("idx_audit_occurred").on(t.occurredAt),
    index("idx_audit_actor").on(t.actorUserId, t.occurredAt),
    index("idx_audit_resource").on(t.resourceType, t.resourceId),
    index("idx_audit_action").on(t.action, t.occurredAt),
  ],
);

/**
 * Durable rate-limit counters.
 *
 * The brief sketched this as `rate_limit_events` (one row per request). A fixed
 * window counter is used instead: a single atomic
 * `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count`
 * costs one round trip and O(1) storage, where an events table costs a row per
 * request plus an aggregate on every check. The semantics the brief asks for —
 * durable, shared across serverless invocations, never process memory — are
 * unchanged. See docs/DATABASE.md.
 */
export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    /** "<bucket>:<subject>", e.g. "login:ip:9f2c…" or "ai_triage:user:<uuid>". */
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("uq_rate_limit_key_window").on(t.key, t.windowStart),
    index("idx_rate_limit_expiry").on(t.expiresAt),
  ],
);

/** Cron run ledger, so a job knows whether an identical run already happened. */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    jobName: text("job_name").notNull(),
    /** Deterministic per logical run, e.g. "reminders:2026-08-27T09:00Z". */
    runKey: text("run_key").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: text("outcome"),
    processedCount: integer("processed_count").notNull().default(0),
    detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    uniqueIndex("uq_job_runs_key").on(t.jobName, t.runKey),
    index("idx_job_runs_started").on(t.jobName, t.startedAt),
  ],
);
