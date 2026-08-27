/**
 * Niramoy — availability, appointments, waitlist
 * -----------------------------------------------------------------------------
 * Appointment integrity is the critical correctness property of this platform.
 * Two mechanisms enforce it, both at the database:
 *
 *   1. UNIQUE (doctor_id, start_utc) — a cheap guard against the exact-duplicate
 *      case, and the one the prototype relied on.
 *
 *   2. An EXCLUDE constraint over tstzrange(start_utc, end_utc) — the real one.
 *      A 10:00–10:30 booking and a 10:15–10:45 booking share no start time, so
 *      (1) permits both; (2) rejects the second. It is declared in raw SQL in
 *      the migration because Drizzle has no builder for EXCLUDE.
 *
 * Both are filtered to live statuses, so a cancelled appointment frees its slot.
 */

import { sql } from "drizzle-orm";
import {
  boolean, index, integer, numeric, pgTable, smallint, text, timestamp,
  uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

import { doctors } from "./directory";
import { familyMembers, patients, users } from "./identity";
import {
  appointmentStatus, appointmentType, exceptionType, waitlistStatus,
} from "./enums";

/**
 * Recurring availability. Minutes-from-midnight rather than a time type, because
 * the scheduling engine works in integers and a window may legitimately end at
 * 1440 (midnight) — which `time` cannot express.
 */
export const doctorAvailability = pgTable(
  "doctor_availability",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "cascade" }),

    weekday: smallint("weekday").notNull(), // 0 = Sunday, matching getUTCDay()
    startMinute: smallint("start_minute").notNull(),
    endMinute: smallint("end_minute").notNull(),
    slotMinutes: smallint("slot_minutes").notNull().default(20),
    bufferMinutes: smallint("buffer_minutes").notNull().default(0),

    /**
     * The zone the window is expressed in. Stored per rule rather than assumed,
     * so "10:00 clinic" means 10:00 where the doctor is even if the platform
     * later serves more than one zone. Storage of instants stays UTC.
     */
    timezone: text("timezone").notNull().default("Asia/Dhaka"),

    validFrom: timestamp("valid_from", { withTimezone: false, mode: "date" }),
    validUntil: timestamp("valid_until", { withTimezone: false, mode: "date" }),
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_availability_doctor").on(t.doctorId, t.weekday)],
);

/** Holidays, leave, and one-off extra clinics. `extra` wins over `block`. */
export const availabilityExceptions = pgTable(
  "availability_exceptions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "cascade" }),

    date: timestamp("date", { withTimezone: false, mode: "date" }).notNull(),
    type: exceptionType("type").notNull(),

    /** Required for `extra`, ignored for `block`. */
    startMinute: smallint("start_minute"),
    endMinute: smallint("end_minute"),
    slotMinutes: smallint("slot_minutes"),
    bufferMinutes: smallint("buffer_minutes"),

    timezone: text("timezone").notNull().default("Asia/Dhaka"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_exceptions_doctor_date").on(t.doctorId, t.date)],
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Short human-facing reference shown on the appointment card. */
    reference: text("reference").notNull(),

    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "restrict" }),
    /** The person being seen — a patient identity, not necessarily an account. */
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    /** Who pressed the button. Differs from patientId for family bookings. */
    bookedByUserId: uuid("booked_by_user_id").references(() => users.id, { onDelete: "set null" }),
    familyMemberId: uuid("family_member_id").references(() => familyMembers.id, { onDelete: "set null" }),

    /**
     * The interval. `endUtc` is what makes overlap detection possible at all —
     * the prototype stored only a start, so 10:00-10:30 and 10:15-10:45 were
     * indistinguishable from two unrelated bookings.
     */
    startUtc: timestamp("start_utc", { withTimezone: true }).notNull(),
    endUtc: timestamp("end_utc", { withTimezone: true }).notNull(),
    durationMinutes: smallint("duration_minutes").notNull(),

    status: appointmentStatus("status").notNull().default("confirmed"),
    type: appointmentType("type").notNull().default("video"),

    /** Patient-supplied. Treated as PHI: never logged, never in an audit row. */
    reason: text("reason"),

    feeAmount: numeric("fee_amount", { precision: 10, scale: 2 }).notNull().default("0"),
    currency: text("currency").notNull().default("BDT"),

    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledByUserId: uuid("cancelled_by_user_id").references(() => users.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),

    /** Set when a reschedule moved this appointment, for the patient's history. */
    rescheduledFromUtc: timestamp("rescheduled_from_utc", { withTimezone: true }),
    rescheduleCount: smallint("reschedule_count").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_appointments_reference").on(t.reference),
    index("idx_appointments_doctor_start").on(t.doctorId, t.startUtc),
    index("idx_appointments_patient_start").on(t.patientId, t.startUtc),
    index("idx_appointments_status_start").on(t.status, t.startUtc),
    // UNIQUE (doctor_id, start_utc) and the EXCLUDE constraint are added as raw
    // SQL in the migration; both are partial, and Drizzle cannot express either.
  ],
);

/** Append-only status trail. Never updated; one row per transition. */
export const appointmentStatusHistory = pgTable(
  "appointment_status_history",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    fromStatus: appointmentStatus("from_status"),
    toStatus: appointmentStatus("to_status").notNull(),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    /** e.g. "patient_cancelled", "no_show_sweep", "doctor_completed". */
    reasonCode: text("reason_code"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_appt_history_appointment").on(t.appointmentId, t.occurredAt)],
);

/**
 * Waitlist. When a slot frees, the first eligible entry is `offered` it with an
 * expiring hold, so allocation is a transaction rather than a race between
 * everyone who got the notification (brief §29).
 */
export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),

    /** The local calendar day the patient is waiting for. */
    targetDate: timestamp("target_date", { withTimezone: false, mode: "date" }).notNull(),
    preferredPeriod: text("preferred_period"),

    status: waitlistStatus("status").notNull().default("waiting"),
    position: integer("position"),

    /** The slot currently held for this entry, and when the hold lapses. */
    offeredStartUtc: timestamp("offered_start_utc", { withTimezone: true }),
    offerExpiresAt: timestamp("offer_expires_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    claimedAppointmentId: uuid("claimed_appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_waitlist_doctor_date").on(t.doctorId, t.targetDate, t.status),
    index("idx_waitlist_patient").on(t.patientId),
    index("idx_waitlist_offer_expiry").on(t.offerExpiresAt),
  ],
);

/**
 * A video room, created server-side and bound to one appointment. Join tokens
 * are minted per participant on request and are not stored (brief §14).
 */
export const videoSessions = pgTable(
  "video_sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    roomName: text("room_name").notNull(),
    /** Provider-side identifier. Never rendered to a client as a joinable URL. */
    providerRoomId: text("provider_room_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),

    /** Off unless separately consented to and enabled. See brief §14. */
    recordingEnabled: boolean("recording_enabled").notNull().default(false),
    doctorJoinedAt: timestamp("doctor_joined_at", { withTimezone: true }),
    patientJoinedAt: timestamp("patient_joined_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_video_sessions_appointment").on(t.appointmentId),
    index("idx_video_sessions_expiry").on(t.expiresAt),
  ],
);
