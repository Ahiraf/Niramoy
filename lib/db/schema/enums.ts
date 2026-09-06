/**
 * Niramoy — PostgreSQL enum types
 * -----------------------------------------------------------------------------
 * Every enum lives here so the set of legal values for a concept is stated once
 * and shared by the schema, the Zod validators and the services.
 */

import { pgEnum } from "drizzle-orm/pg-core";

/* ---- Identity -------------------------------------------------------------- */

export const userRole = pgEnum("user_role", ["patient", "doctor", "admin"]);

export const userStatus = pgEnum("user_status", ["active", "suspended", "deactivated"]);

/* ---- Doctor verification ---------------------------------------------------- */

/**
 * The full lifecycle required by the brief. `unsubmitted` is the state of a
 * doctor account that has registered but not yet filed a BM&DC application.
 */
export const verificationStatus = pgEnum("verification_status", [
  "unsubmitted",
  "pending",
  "verified",
  "rejected",
  "suspended",
  "expired",
]);

/**
 * How a registration number was confirmed. `manual_admin` means a human opened
 * verify.bmdc.org.bd and checked it; `bmdc_api` means a configured
 * data-sharing endpoint answered. There is no third option, and in particular
 * there is no automated-scrape option — see lib/bmdc.ts.
 */
export const verificationMethod = pgEnum("verification_method", ["manual_admin", "bmdc_api"]);

export const documentKind = pgEnum("document_kind", [
  "bmdc_certificate",
  "degree",
  "national_id",
  "photo",
  "other",
]);

/* ---- Scheduling ------------------------------------------------------------- */

export const exceptionType = pgEnum("exception_type", ["block", "extra"]);

export const appointmentStatus = pgEnum("appointment_status", [
  "pending",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
]);

export const appointmentType = pgEnum("appointment_type", ["video", "audio", "follow_up"]);

export const waitlistStatus = pgEnum("waitlist_status", [
  "waiting",
  "offered",
  "claimed",
  "expired",
  "cancelled",
]);

/* ---- Clinical --------------------------------------------------------------- */

export const recordKind = pgEnum("record_kind", [
  "note",
  "lab",
  "imaging",
  "prescription",
  "visit_summary",
  "upload",
  "amendment",
]);

/**
 * `clinician_only` exists for notes a doctor records for continuity of care.
 * It is NOT a mechanism for hiding a patient's own results from them; the
 * access rules are documented in docs/AUTHORIZATION.md and require legal review
 * before any production use (docs/REGULATORY_ASSUMPTIONS.md, A1).
 */
export const recordVisibility = pgEnum("record_visibility", ["patient_visible", "clinician_only"]);

export const prescriptionStatus = pgEnum("prescription_status", ["draft", "issued", "cancelled"]);

export const familyAccessLevel = pgEnum("family_access_level", [
  "none",
  "appointments_only",
  "full",
]);

export const reviewStatus = pgEnum("review_status", ["published", "pending_moderation", "removed"]);

/* ---- AI --------------------------------------------------------------------- */

export const urgencyLevel = pgEnum("urgency_level", [
  "emergency",
  "urgent",
  "see_doctor_soon",
  "routine",
  "self_care",
]);

/** Which layer produced the final answer. `rules` is always the safe fallback. */
export const aiSource = pgEnum("ai_source", ["rules", "llm"]);

export const aiReviewStatus = pgEnum("ai_review_status", ["pending", "approved", "edited", "rejected"]);

/**
 * The clinical-safety event taxonomy from the brief. This single table subsumes
 * what the brief sketched as `emergency_events`; keeping one ordered event
 * stream makes the safety timeline for a consultation readable in one query.
 */
export const safetyEventType = pgEnum("safety_event_type", [
  "triage_emergency",
  "triage_non_emergency",
  "rule_engine_activation",
  "llm_invocation",
  "llm_failure",
  "llm_output_rejected",
  "llm_downgrade_blocked",
  "emergency_advice_shown",
  "doctor_override",
  "ai_summary_rejected",
  "ai_summary_corrected",
]);

/* ---- Platform --------------------------------------------------------------- */

export const notificationChannel = pgEnum("notification_channel", ["in_app", "email", "sms"]);

export const notificationStatus = pgEnum("notification_status", [
  "pending",
  "sent",
  "failed",
  "suppressed",
]);

export const auditOutcome = pgEnum("audit_outcome", ["success", "denied", "failure"]);

/**
 * How the patient chose to pay. `bkash` is the mobile wallet nearly every
 * patient in Bangladesh already has; `cash` means they settle at the chamber,
 * which is still how most consultations are actually paid for and must remain
 * a first-class option rather than a fallback.
 */
export const paymentMethod = pgEnum("payment_method", ["bkash", "cash"]);

export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "authorized",
  "succeeded",
  "failed",
  "refunded",
  "cancelled",
]);

export const tokenPurpose = pgEnum("token_purpose", [
  "email_verification",
  "password_reset",
  "phone_verification",
]);
