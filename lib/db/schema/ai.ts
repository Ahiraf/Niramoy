/**
 * Niramoy — AI provenance and clinical-safety tables
 * -----------------------------------------------------------------------------
 * Two principles shape these tables.
 *
 * PROVENANCE. Every AI output records which rule set, provider, model and
 * prompt version produced it, and who reviewed it. Without that, an AI-assisted
 * clinical record cannot be audited after the fact.
 *
 * MINIMISATION. Raw symptom text is NOT stored here by default (brief §19).
 * A triage session keeps a hash, a length and a detected language, which is
 * enough to reproduce a safety investigation without retaining a patient's
 * description of their symptoms in an operational table.
 */

import { sql } from "drizzle-orm";
import {
  boolean, index, integer, jsonb, pgTable, smallint, text, timestamp, uuid,
} from "drizzle-orm/pg-core";

import { appointments } from "./scheduling";
import { doctors, specialties } from "./directory";
import { medicalRecords } from "./clinical";
import { patients, users } from "./identity";
import { aiReviewStatus, aiSource, safetyEventType, urgencyLevel } from "./enums";

export const aiTriageSessions = pgTable(
  "ai_triage_sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    patientId: uuid("patient_id").references(() => patients.id, { onDelete: "set null" }),

    /* ---- Outcome -------------------------------------------------------- */
    urgency: urgencyLevel("urgency").notNull(),
    /** The urgency the deterministic rules produced, before any model ran.
     *  The final `urgency` may never be less severe than this. */
    ruleUrgency: urgencyLevel("rule_urgency").notNull(),
    suggestedSpecialtyId: text("suggested_specialty_id").references(() => specialties.id),

    redFlagTriggered: boolean("red_flag_triggered").notNull().default(false),
    /** Identifier of the rule that fired, e.g. "rf.chest_pain". Not the text. */
    redFlagRuleId: text("red_flag_rule_id"),

    /* ---- Provenance ------------------------------------------------------ */
    source: aiSource("source").notNull(),
    ruleSetVersion: text("rule_set_version").notNull(),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),

    llmInvoked: boolean("llm_invoked").notNull().default(false),
    llmFailed: boolean("llm_failed").notNull().default(false),
    llmOutputRejected: boolean("llm_output_rejected").notNull().default(false),
    /** True when the model tried to lower the rule-engine urgency and was
     *  overruled. This is a safety signal worth counting. */
    llmDowngradeBlocked: boolean("llm_downgrade_blocked").notNull().default(false),

    /* ---- Minimised input ------------------------------------------------- */
    inputSha256: text("input_sha256").notNull(),
    inputCharCount: integer("input_char_count").notNull(),
    inputLanguage: text("input_language"),
    /** Only populated when a retention policy explicitly enables it. */
    inputTextRetained: text("input_text_retained"),

    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_triage_user").on(t.userId, t.createdAt),
    index("idx_triage_urgency").on(t.urgency, t.createdAt),
    index("idx_triage_red_flag").on(t.redFlagTriggered, t.createdAt),
  ],
);

/**
 * An AI-drafted visit summary. `requiresReview` is NOT NULL DEFAULT true and is
 * additionally pinned by a CHECK constraint in the migration: there is no way to
 * insert a summary that claims it does not need a doctor. The draft becomes part
 * of the medical record only when a doctor approves it, at which point
 * `publishedRecordId` is set.
 */
export const aiVisitSummaries = pgTable(
  "ai_visit_summaries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),

    /** The model's structured draft, after schema validation. */
    draft: jsonb("draft").notNull(),
    /** What the doctor actually approved, if they edited the draft. */
    approvedContent: jsonb("approved_content"),

    /* ---- Provenance ------------------------------------------------------ */
    source: aiSource("source").notNull(),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version").notNull(),
    ruleSetVersion: text("rule_set_version"),
    /** Where the input came from: "doctor_notes", "transcript", "none". */
    inputProvenance: text("input_provenance").notNull(),

    /* ---- Review ---------------------------------------------------------- */
    requiresReview: boolean("requires_review").notNull().default(true),
    reviewStatus: aiReviewStatus("review_status").notNull().default("pending"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    /** Set once the approved summary has been written into the record. */
    publishedRecordId: uuid("published_record_id").references(() => medicalRecords.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_ai_summaries_appointment").on(t.appointmentId),
    index("idx_ai_summaries_review").on(t.reviewStatus, t.createdAt),
  ],
);

/**
 * The clinical-safety event stream (brief §32). Deliberately carries no free
 * clinical text — `detail` holds rule identifiers, versions and counts, so the
 * safety dashboard can be built without exposing anyone's symptoms.
 */
export const safetyEvents = pgTable(
  "safety_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    type: safetyEventType("type").notNull(),
    /** 1 = informational … 5 = requires human follow-up. */
    severity: smallint("severity").notNull().default(1),

    triageSessionId: uuid("triage_session_id").references(() => aiTriageSessions.id, {
      onDelete: "set null",
    }),
    summaryId: uuid("summary_id").references(() => aiVisitSummaries.id, { onDelete: "set null" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),

    /** Rule ids, versions, counts. Never symptom text, never a diagnosis. */
    detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
    requestId: text("request_id"),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_safety_events_type").on(t.type, t.occurredAt),
    index("idx_safety_events_severity").on(t.severity, t.occurredAt),
  ],
);
