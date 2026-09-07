/**
 * Niramoy — medical records, prescriptions, reviews
 * -----------------------------------------------------------------------------
 * Clinical history is append-only. A correction never overwrites the original:
 * it inserts an amendment that points at what it supersedes, and the original
 * row stays readable. Deleting an account does not delete these rows
 * (brief §30) — see docs/REGULATORY_ASSUMPTIONS.md, A1.
 */

import { sql } from "drizzle-orm";
import {
  boolean, index, integer, pgTable, smallint, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

import { appointments } from "./scheduling";
import { doctors } from "./directory";
import { patients, users } from "./identity";
import {
  prescriptionStatus, recordKind, recordVisibility, reviewStatus, userRole,
} from "./enums";

export const medicalRecords = pgTable(
  "medical_records",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),

    /** Who wrote it. Required — an unattributed clinical note is not a record. */
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorRole: userRole("author_role").notNull(),
    authorDisplayName: text("author_display_name").notNull(),

    kind: recordKind("kind").notNull().default("note"),
    visibility: recordVisibility("visibility").notNull().default("patient_visible"),

    title: text("title").notNull(),
    body: text("body"),
    /** Private object-storage key. Downloads go through an authorized handler. */
    fileKey: text("file_key"),
    fileMimeType: text("file_mime_type"),
    fileSizeBytes: integer("file_size_bytes"),

    /**
     * Amendment chain. A correction inserts a new row whose `supersedesId`
     * points at the row it replaces, and flips the old row's `isCurrent` to
     * false. Nothing is ever UPDATEd in place except that one flag, and nothing
     * is ever deleted.
     */
    supersedesId: uuid("supersedes_id"),
    isCurrent: boolean("is_current").notNull().default(true),
    amendmentReason: text("amendment_reason"),

    /** When the clinical event happened, if different from when it was filed. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_records_patient_created").on(t.patientId, t.createdAt),
    index("idx_records_appointment").on(t.appointmentId),
    index("idx_records_current").on(t.patientId, t.isCurrent),
    index("idx_records_supersedes").on(t.supersedesId),
  ],
);

/**
 * A prescription. Created only by the doctor on the appointment — enforced in
 * the service layer and asserted by the security test suite (brief §61.3).
 * AI never writes here: an AI draft lives in `ai_visit_summaries` until a
 * doctor confirms it.
 */
export const prescriptions = pgTable(
  "prescriptions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    prescriptionNumber: text("prescription_number").notNull(),

    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "restrict" }),
    /** The account that issued it, for audit; `doctorId` is the clinical author. */
    issuedByUserId: uuid("issued_by_user_id").references(() => users.id, { onDelete: "set null" }),

    diagnosis: text("diagnosis"),
    notes: text("notes"),
    advice: text("advice"),
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),

    status: prescriptionStatus("status").notNull().default("draft"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    /** Corrections supersede rather than edit, as with medical records. */
    supersedesId: uuid("supersedes_id"),
    isCurrent: boolean("is_current").notNull().default(true),

    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_prescriptions_number").on(t.prescriptionNumber),
    index("idx_prescriptions_patient").on(t.patientId, t.createdAt),
    index("idx_prescriptions_doctor").on(t.doctorId),
    index("idx_prescriptions_appointment").on(t.appointmentId),
  ],
);

/**
 * One medication line. The fields are the ones a prescription must carry to be
 * dispensable (brief §13); none is derived from an AI suggestion without a
 * doctor having typed or confirmed it.
 */
export const prescriptionItems = pgTable(
  "prescription_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    prescriptionId: uuid("prescription_id")
      .notNull()
      .references(() => prescriptions.id, { onDelete: "cascade" }),
    position: smallint("position").notNull().default(0),

    medicine: text("medicine").notNull(),
    strength: text("strength"),
    dose: text("dose"),
    route: text("route"),
    frequency: text("frequency"),
    duration: text("duration"),
    quantity: text("quantity"),
    instructions: text("instructions"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_prescription_items_prescription").on(t.prescriptionId, t.position)],
);

/**
 * One review per completed appointment, written by the patient who attended it.
 * Eligibility is checked in the service; the unique index makes a second review
 * impossible even under a race.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),

    rating: smallint("rating").notNull(),
    comment: text("comment"),

    status: reviewStatus("status").notNull().default("published"),
    moderatedByUserId: uuid("moderated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    moderationNote: text("moderation_note"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_reviews_appointment").on(t.appointmentId),
    index("idx_reviews_doctor").on(t.doctorId, t.status),
  ],
);
