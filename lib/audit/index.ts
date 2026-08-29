/**
 * Niramoy — audit logging
 * -----------------------------------------------------------------------------
 * Records THAT something happened, not WHAT was in it.
 *
 * An audit row carries actors, resource identifiers, an outcome and counts. It
 * never carries a symptom description, a diagnosis, a prescription line, a
 * password or a token — those are the things an audit log is most tempting to
 * put in and most damaging to leak. `metadata` is passed through the logger's
 * redactor on the way in, so a careless caller cannot smuggle PHI into it.
 *
 * The table rejects UPDATE and DELETE at the database, so this is append-only in
 * fact rather than by convention.
 */

import { getDb, type Database } from "../db/client";
import * as t from "../db/schema";
import { redact } from "../observability/logger";
import { logger } from "../observability/logger";
import type { UserRole } from "../repositories/users";

/** Dotted verbs. Keep the vocabulary small and the tense consistent. */
export type AuditAction =
  | "auth.register"
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "auth.password_change"
  | "auth.password_reset_request"
  | "auth.password_reset_complete"
  | "auth.email_verify"
  | "auth.account_locked"
  | "profile.update"
  | "doctor.verification_submit"
  | "doctor.verification_approve"
  | "doctor.verification_reject"
  | "doctor.suspend"
  | "doctor.reinstate"
  | "appointment.create"
  | "appointment.cancel"
  | "appointment.reschedule"
  | "appointment.complete"
  | "appointment.no_show"
  | "record.read"
  | "record.create"
  | "record.amend"
  | "prescription.create"
  | "prescription.read"
  | "prescription.cancel"
  | "family.add"
  | "family.remove"
  | "review.create"
  | "review.moderate"
  | "video.token_issue"
  | "ai.triage"
  | "ai.summary_generate"
  | "ai.summary_approve"
  | "ai.summary_reject"
  | "payment.create"
  | "payment.execute"
  | "payment.webhook"
  | "admin.action"
  | "cron.run";

export interface AuditEntry {
  action: AuditAction;
  actorUserId?: string | null;
  actorRole?: UserRole | null;
  actorIpHash?: string | null;
  requestId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  subjectUserId?: string | null;
  outcome?: "success" | "denied" | "failure";
  metadata?: Record<string, unknown>;
}

/**
 * Write one audit row.
 *
 * Never throws. An audit write failing must not fail the operation it is
 * describing — the alternative is that a logging outage becomes a service
 * outage. A failure is logged loudly instead, so it is visible without being
 * fatal.
 */
export async function audit(entry: AuditEntry, db: Database = getDb()): Promise<void> {
  try {
    await db.insert(t.auditLogs).values({
      action: entry.action,
      actorUserId: entry.actorUserId ?? null,
      actorRole: entry.actorRole ?? null,
      actorIpHash: entry.actorIpHash ?? null,
      requestId: entry.requestId ?? null,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
      subjectUserId: entry.subjectUserId ?? null,
      outcome: entry.outcome ?? "success",
      metadata: (redact(entry.metadata ?? {}) ?? {}) as Record<string, unknown>,
    });
  } catch (err) {
    logger.error("audit write failed", { action: entry.action, err });
  }
}
