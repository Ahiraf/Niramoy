/**
 * Niramoy — AI orchestration
 * -----------------------------------------------------------------------------
 * Persists triage sessions and summary drafts, records safety events, and owns
 * the approval step that turns a reviewed draft into a medical record.
 */

import { and, eq } from "drizzle-orm";

import { audit } from "../audit";
import { getDb } from "../db/client";
import * as t from "../db/schema";
import { AppError } from "../errors";
import { logger } from "../observability/logger";
import * as clinical from "../repositories/clinical";
import * as directory from "../repositories/doctors";
import { draftVisitSummary, type SummaryDraft } from "../ai/summary";
import { triage, type TriageResult } from "../ai/triage";
import type { Intake } from "../ai/rules";
import type { Principal } from "../security/authz";

/* -------------------------------------------------------------------------- */
/* Safety events                                                               */
/* -------------------------------------------------------------------------- */

type SafetyEventType =
  | "triage_emergency"
  | "triage_non_emergency"
  | "rule_engine_activation"
  | "llm_invocation"
  | "llm_failure"
  | "llm_output_rejected"
  | "llm_downgrade_blocked"
  | "emergency_advice_shown"
  | "doctor_override"
  | "ai_summary_rejected"
  | "ai_summary_corrected";

/** `detail` carries rule ids, versions and counts — never symptom text. */
async function recordSafetyEvent(input: {
  type: SafetyEventType;
  severity?: number;
  triageSessionId?: string | null;
  summaryId?: string | null;
  appointmentId?: string | null;
  userId?: string | null;
  detail?: Record<string, unknown>;
  requestId?: string;
}): Promise<void> {
  try {
    await getDb()
      .insert(t.safetyEvents)
      .values({
        type: input.type,
        severity: input.severity ?? 1,
        triageSessionId: input.triageSessionId ?? null,
        summaryId: input.summaryId ?? null,
        appointmentId: input.appointmentId ?? null,
        userId: input.userId ?? null,
        detail: input.detail ?? {},
        requestId: input.requestId ?? null,
      });
  } catch (err) {
    // As with the audit log: visible, never fatal.
    logger.error("safety event write failed", { type: input.type, err });
  }
}

/* -------------------------------------------------------------------------- */
/* Triage                                                                      */
/* -------------------------------------------------------------------------- */

export async function runTriage(
  principal: Principal | null,
  message: string,
  context: { requestId?: string; intake?: Intake },
): Promise<{ result: TriageResult; sessionId: string | null }> {
  const result = await triage(message, context.intake ?? {});

  let sessionId: string | null = null;
  try {
    const rows = await getDb()
      .insert(t.aiTriageSessions)
      .values({
        userId: principal?.userId ?? null,
        patientId: principal?.patientId ?? null,
        urgency: result.urgency,
        ruleUrgency: result.ruleUrgency,
        suggestedSpecialtyId: result.specialtyId,
        redFlagTriggered: Boolean(result.redFlag),
        redFlagRuleId: result.redFlagRuleId,
        source: result.source,
        ruleSetVersion: result.meta.ruleSetVersion,
        provider: result.meta.provider,
        model: result.meta.model,
        promptVersion: result.meta.promptVersion,
        llmInvoked: result.meta.llmInvoked,
        llmFailed: result.meta.llmFailed,
        llmOutputRejected: result.meta.llmOutputRejected,
        llmDowngradeBlocked: result.meta.llmDowngradeBlocked,
        // The description itself is NOT stored — a hash, a length and a
        // detected language are enough to reproduce a safety investigation.
        inputSha256: result.meta.inputSha256,
        inputCharCount: result.meta.inputCharCount,
        inputLanguage: result.meta.inputLanguage,
        latencyMs: result.meta.latencyMs,
      })
      .returning({ id: t.aiTriageSessions.id });
    sessionId = rows[0]?.id ?? null;
  } catch (err) {
    // A failed provenance write must not deny a patient their triage answer,
    // particularly an emergency one.
    logger.error("triage session write failed", { err });
  }

  await recordSafetyEvent({
    type: result.redFlag ? "triage_emergency" : "triage_non_emergency",
    severity: result.redFlag ? 5 : 1,
    triageSessionId: sessionId,
    userId: principal?.userId ?? null,
    requestId: context.requestId,
    detail: {
      redFlagRuleId: result.redFlagRuleId,
      urgency: result.urgency,
      ruleSetVersion: result.meta.ruleSetVersion,
      language: result.meta.inputLanguage,
    },
  });

  if (result.meta.llmDowngradeBlocked) {
    await recordSafetyEvent({
      type: "llm_downgrade_blocked",
      severity: 4,
      triageSessionId: sessionId,
      userId: principal?.userId ?? null,
      requestId: context.requestId,
      detail: { ruleUrgency: result.ruleUrgency, finalUrgency: result.urgency },
    });
  }
  if (result.meta.llmOutputRejected) {
    await recordSafetyEvent({
      type: "llm_output_rejected",
      severity: 3,
      triageSessionId: sessionId,
      requestId: context.requestId,
    });
  }
  if (result.meta.llmFailed) {
    await recordSafetyEvent({
      type: "llm_failure",
      severity: 2,
      triageSessionId: sessionId,
      requestId: context.requestId,
    });
  }
  if (result.meta.injectionDetected) {
    await recordSafetyEvent({
      type: "llm_output_rejected",
      severity: 3,
      triageSessionId: sessionId,
      userId: principal?.userId ?? null,
      requestId: context.requestId,
      detail: { note: "prompt injection pattern detected in patient input" },
    });
  }

  await audit({
    action: "ai.triage",
    actorUserId: principal?.userId ?? null,
    actorRole: principal?.role ?? null,
    requestId: context.requestId,
    resourceType: "ai_triage_session",
    resourceId: sessionId,
    metadata: { urgency: result.urgency, redFlag: Boolean(result.redFlag), source: result.source },
  });

  return { result, sessionId };
}

/**
 * Rank doctors for a triage result.
 *
 * Explicitly NOT an opaque score (brief §27). Every recommendation carries the
 * factors that produced it, so a patient can see "matches cardiology, speaks
 * Bangla, available today" rather than being told an AI thinks this doctor is
 * best.
 */
export interface DoctorMatch {
  doctor: directory.DoctorView;
  score: number;
  why: string[];
}

export function matchDoctors(
  result: TriageResult,
  doctors: directory.DoctorView[],
  preferences: { district?: string | null; division?: string | null; maxFee?: number },
): DoctorMatch[] {
  return doctors
    .map((doctor) => {
      let score = 0;
      const why: string[] = [];

      if (doctor.specialtyId === result.specialtyId) {
        score += 50;
        why.push(`Specialises in ${doctor.specialty}`);
      } else if (result.isChild && doctor.specialtyId === "pediatrics") {
        score += 34;
        why.push("Paediatrician — sees children");
      } else if (doctor.specialtyId === "general") {
        score += 18;
        why.push("General Physician — can assess and refer");
      }

      if (preferences.district && doctor.district === preferences.district) {
        score += 14;
        why.push(`Practises in ${doctor.district}`);
      } else if (preferences.division && doctor.division === preferences.division) {
        score += 7;
        why.push(`Practises in ${doctor.division} division`);
      }

      score += Math.min(doctor.rating, 5) * 4;
      if (doctor.ratingCount > 60) score += 4;
      if (doctor.experienceYears >= 10) {
        score += 5;
        why.push(`${doctor.experienceYears} years of experience`);
      }

      if (preferences.maxFee) {
        if (doctor.fee <= preferences.maxFee) {
          score += 8;
          why.push(`Within your ৳${preferences.maxFee} budget`);
        } else {
          score -= 12;
        }
      }

      if (doctor.languages.includes("Bangla")) why.push("Speaks Bangla");

      return { doctor, score, why: why.slice(0, 3) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

/* -------------------------------------------------------------------------- */
/* Visit summaries                                                             */
/* -------------------------------------------------------------------------- */

/** Generate a draft. Doctor-only, and only for their own consultation. */
export async function generateSummary(
  principal: Principal,
  input: { appointmentId?: unknown; transcript?: unknown },
  context: { requestId?: string },
): Promise<{ id: string; draft: SummaryDraft }> {
  const db = getDb();

  const profile = await directory.getProfileForUser(principal.userId);
  if (!profile) throw new AppError("FORBIDDEN");

  const appointmentId = String(input.appointmentId ?? "");
  const rows = await db
    .select({
      id: t.appointments.id,
      patientId: t.appointments.patientId,
      patientName: t.patients.displayName,
    })
    .from(t.appointments)
    .innerJoin(t.patients, eq(t.appointments.patientId, t.patients.id))
    .where(and(eq(t.appointments.id, appointmentId), eq(t.appointments.doctorId, profile.id)))
    .limit(1);

  const appointment = rows[0];
  if (!appointment) throw new AppError("NOT_FOUND");

  const draft = await draftVisitSummary({
    transcript: input.transcript === undefined ? null : String(input.transcript),
    patientName: appointment.patientName,
    doctorName: profile.displayName,
  });

  const inserted = await db
    .insert(t.aiVisitSummaries)
    .values({
      appointmentId: appointment.id,
      doctorId: profile.id,
      patientId: appointment.patientId,
      draft: draft as unknown as Record<string, unknown>,
      source: draft.source,
      provider: draft.meta.provider,
      model: draft.meta.model,
      promptVersion: draft.meta.promptVersion,
      ruleSetVersion: draft.meta.ruleSetVersion,
      inputProvenance: draft.meta.inputProvenance,
      // Pinned true by a CHECK constraint as well; stating it here documents
      // that it is not something the caller chooses.
      requiresReview: true,
      reviewStatus: "pending",
    })
    .returning({ id: t.aiVisitSummaries.id });

  await audit({
    action: "ai.summary_generate",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId: context.requestId,
    resourceType: "ai_visit_summary",
    resourceId: inserted[0]!.id,
    metadata: { appointmentId: appointment.id, source: draft.source },
  });

  return { id: inserted[0]!.id, draft };
}

/**
 * Approve a draft, optionally with edits, and write it into the record.
 *
 * This is the ONLY path from an AI draft to a patient's medical history. The
 * record it creates is authored by the doctor, not by the model — the doctor's
 * name is on it, because they confirmed it.
 */
export async function approveSummary(
  principal: Principal,
  summaryId: string,
  input: { edited?: unknown; note?: unknown },
  context: { requestId?: string },
): Promise<{ recordId: string }> {
  const db = getDb();

  const profile = await directory.getProfileForUser(principal.userId);
  if (!profile) throw new AppError("FORBIDDEN");

  const rows = await db
    .select()
    .from(t.aiVisitSummaries)
    .where(and(eq(t.aiVisitSummaries.id, summaryId), eq(t.aiVisitSummaries.doctorId, profile.id)))
    .limit(1);

  const summary = rows[0];
  if (!summary) throw new AppError("NOT_FOUND");
  if (summary.reviewStatus !== "pending") {
    throw new AppError("NOT_ELIGIBLE", { message: "That summary has already been reviewed." });
  }

  const draft = summary.draft as unknown as SummaryDraft;
  const edited = (input.edited ?? null) as Partial<SummaryDraft> | null;
  const wasEdited = Boolean(edited);

  const approved = {
    summary: String(edited?.summary ?? draft.summary ?? "").slice(0, 8000),
    diagnosis: String(edited?.diagnosis ?? draft.diagnosis ?? "").slice(0, 600),
    advice: String(edited?.advice ?? draft.advice ?? "").slice(0, 4000),
    followUp: String(edited?.followUp ?? draft.followUp ?? "").slice(0, 600),
  };

  const record = await clinical.createRecord({
    patientId: summary.patientId,
    authorUserId: principal.userId,
    // The DOCTOR is the author. They reviewed it and put their name to it.
    authorRole: "doctor",
    authorDisplayName: profile.displayName,
    kind: "visit_summary",
    title: approved.diagnosis || "Consultation summary",
    body: [approved.summary, approved.advice, approved.followUp].filter(Boolean).join("\n\n"),
    appointmentId: summary.appointmentId,
  });

  await db
    .update(t.aiVisitSummaries)
    .set({
      reviewStatus: wasEdited ? "edited" : "approved",
      reviewedByUserId: principal.userId,
      reviewedAt: new Date(),
      reviewNote: input.note ? String(input.note).slice(0, 1000) : null,
      approvedContent: approved,
      publishedRecordId: record.id,
    })
    .where(eq(t.aiVisitSummaries.id, summaryId));

  if (wasEdited) {
    await recordSafetyEvent({
      type: "ai_summary_corrected",
      severity: 2,
      summaryId,
      appointmentId: summary.appointmentId,
      userId: principal.userId,
      requestId: context.requestId,
    });
  }

  await audit({
    action: "ai.summary_approve",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId: context.requestId,
    resourceType: "ai_visit_summary",
    resourceId: summaryId,
    metadata: { edited: wasEdited, recordId: record.id },
  });

  return { recordId: record.id };
}

/** Reject a draft. Nothing reaches the record. */
export async function rejectSummary(
  principal: Principal,
  summaryId: string,
  reason: string,
  context: { requestId?: string },
): Promise<void> {
  const db = getDb();
  const profile = await directory.getProfileForUser(principal.userId);
  if (!profile) throw new AppError("FORBIDDEN");

  const updated = await db
    .update(t.aiVisitSummaries)
    .set({
      reviewStatus: "rejected",
      reviewedByUserId: principal.userId,
      reviewedAt: new Date(),
      reviewNote: reason.slice(0, 1000),
    })
    .where(
      and(
        eq(t.aiVisitSummaries.id, summaryId),
        eq(t.aiVisitSummaries.doctorId, profile.id),
        eq(t.aiVisitSummaries.reviewStatus, "pending"),
      ),
    )
    .returning({ id: t.aiVisitSummaries.id, appointmentId: t.aiVisitSummaries.appointmentId });

  if (!updated[0]) throw new AppError("NOT_FOUND");

  await recordSafetyEvent({
    type: "ai_summary_rejected",
    severity: 3,
    summaryId,
    appointmentId: updated[0].appointmentId,
    userId: principal.userId,
    requestId: context.requestId,
  });

  await audit({
    action: "ai.summary_reject",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId: context.requestId,
    resourceType: "ai_visit_summary",
    resourceId: summaryId,
  });
}
