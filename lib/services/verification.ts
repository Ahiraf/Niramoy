/**
 * Niramoy — doctor verification
 * -----------------------------------------------------------------------------
 * How a real doctor gets onto the platform, and the reason there is no bulk
 * import.
 *
 * The Bangladesh Medical & Dental Council publishes a verification service that
 * answers one question — "is registration number X valid, and whose is it?" —
 * one lookup at a time, behind a captcha. There is no official API, no bulk
 * export, and no public list of registered practitioners. So verification is
 * PULL, not PUSH:
 *
 *   doctor registers → submits their registration number → status: pending
 *     → an admin opens verify.bmdc.org.bd, checks it, records what it said
 *     → status: verified → the profile is published and becomes bookable
 *
 * On automation: we do not ship a captcha-solving scraper. The captcha is an
 * access control, and defeating it to harvest the register would be a terms
 * violation and a privacy problem for practitioners who never agreed to be
 * listed on a third-party platform. If BM&DC — or an institution with a
 * data-sharing agreement — provides a real endpoint, BMDC_API_URL is called
 * instead, and if it is unreachable the application falls back to human review.
 *
 * It never fails open. There is no path from "submitted" to "verified" that does
 * not pass through either a real registry response or a named human.
 */

import { and, desc, eq } from "drizzle-orm";

import { audit } from "../audit";
import * as approvals from "../repositories/doctor-approvals";
import { getDb } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import * as t from "../db/schema";
import { AppError } from "../errors";
import { initialsOf } from "./auth";
import * as clinical from "../repositories/clinical";
import type { Principal } from "../security/authz";
// The BM&DC adapter is still JavaScript; its behaviour is unchanged.
import * as bmdcModule from "../bmdc.js";

interface BmdcModule {
  validateRegistrationNumber(
    raw: unknown,
    declaredType?: unknown,
  ): { ok: boolean; normalised?: string; type?: string; reason?: string };
  verifyRegistration(
    registrationNumber: string,
    type: string,
  ): Promise<{ status: string; source: string; record?: unknown; reason?: string }>;
  bmdcVerifyUrl(): string;
}

const bmdc = bmdcModule as unknown as BmdcModule;

export interface ApplicationView {
  id: string;
  name: string;
  bmdcNumber: string;
  registrationType: string;
  specialtyId: string | null;
  specialty: string | null;
  degrees: string | null;
  facility: string | null;
  district: string | null;
  division: string | null;
  experienceYears: number | null;
  email: string | null;
  status: string;
  method: string | null;
  submittedAt: string;
  decidedAt: string | null;
  notes: string | null;
  lookupSource: string | null;
  doctorId: string | null;
}

/** "09:30" -> 570. Local minutes past midnight, for the rule's own timezone. */
function minutesFromLocalTime(value: unknown): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? ""));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * The consulting hours an applicant claims.
 *
 * The client also sends a `start`/`end` pair it derived by subtracting six
 * hours, but that is discarded here: doctor_availability stores LOCAL minutes
 * beside the zone they belong to, and the scheduling engine converts. Trusting
 * a browser's timezone arithmetic would bake today's offset into a stored rule.
 */
function readClaimedAvailability(value: unknown): Array<{
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  bufferMinutes: number;
}> {
  if (!Array.isArray(value)) return [];

  const rules = [];
  for (const raw of value.slice(0, 21)) {
    const row = raw as Record<string, unknown>;
    const weekday = Number(row.weekday);
    const startMinute = minutesFromLocalTime(row.localStart);
    const endMinute = minutesFromLocalTime(row.localEnd);
    const slotMinutes = Number(row.slotMinutes);

    // A window that does not run forwards produces no slots, so it is not a
    // rule — it is a mistake, and keeping it would be a schedule that silently
    // shows nothing.
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    if (startMinute === null || endMinute === null || endMinute <= startMinute) continue;
    if (!Number.isFinite(slotMinutes) || slotMinutes < 5 || slotMinutes > 120) continue;

    rules.push({
      weekday,
      startMinute,
      endMinute,
      slotMinutes,
      bufferMinutes: Math.min(60, Math.max(0, Number(row.bufferMinutes) || 0)),
    });
  }
  return rules;
}

export async function listQueue(): Promise<ApplicationView[]> {
  const rows = await getDb()
    .select({
      id: t.doctorVerifications.id,
      name: t.doctorVerifications.claimedName,
      bmdcNumber: t.doctorVerifications.registrationNumber,
      registrationType: t.doctorVerifications.registrationType,
      specialtyId: t.doctorVerifications.claimedSpecialtyId,
      specialty: t.specialties.name,
      degrees: t.doctorVerifications.claimedDegrees,
      facility: t.doctorVerifications.claimedFacility,
      district: t.districts.name,
      division: t.divisions.name,
      experienceYears: t.doctorVerifications.claimedExperienceYears,
      email: t.doctorVerifications.contactEmail,
      status: t.doctorVerifications.status,
      method: t.doctorVerifications.method,
      submittedAt: t.doctorVerifications.submittedAt,
      decidedAt: t.doctorVerifications.decidedAt,
      notes: t.doctorVerifications.notes,
      lookupSource: t.doctorVerifications.lookupSource,
      doctorId: t.doctorVerifications.doctorId,
    })
    .from(t.doctorVerifications)
    .leftJoin(t.specialties, eq(t.doctorVerifications.claimedSpecialtyId, t.specialties.id))
    .leftJoin(t.districts, eq(t.doctorVerifications.claimedDistrictId, t.districts.id))
    .leftJoin(t.divisions, eq(t.doctorVerifications.claimedDivisionId, t.divisions.id))
    .orderBy(desc(t.doctorVerifications.submittedAt))
    .limit(200);

  return rows.map((r) => ({
    ...r,
    submittedAt: r.submittedAt.toISOString(),
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
  }));
}

export const verifyUrl = (): string => bmdc.bmdcVerifyUrl();

/* -------------------------------------------------------------------------- */
/* Apply                                                                       */
/* -------------------------------------------------------------------------- */

export async function apply(
  principal: Principal,
  input: Record<string, unknown>,
  context: { requestId?: string },
): Promise<{ application: ApplicationView; lookup: { status: string; source: string } }> {
  const shape = bmdc.validateRegistrationNumber(input.bmdcNumber, input.registrationType);
  if (!shape.ok) {
    throw new AppError("BMDC_INVALID", { meta: { reason: shape.reason } });
  }

  /**
   * Consult a configured registry endpoint. With none configured this returns
   * `pending` with source `manual_required`, which is the honest answer: we do
   * not know, and a human must look.
   */
  const lookup = await bmdc.verifyRegistration(shape.normalised!, shape.type!);

  /**
   * The admin approval this account was created from, if it still matches.
   *
   * A doctor account only exists because an admin checked this registration
   * number against the register by hand and approved it. Asking them to check
   * the same number a second time here would add no information, so an
   * application quoting the approved number publishes on submission.
   *
   * Re-read rather than trusted from the account, and compared against the
   * number actually being applied for: an approval for A-45312 says nothing
   * about A-99999, and a doctor who types a different number here has not
   * been approved for it. That case falls through to the admin queue, which is
   * where an unchecked number belongs.
   */
  const approval = await approvals.approvalClaimedBy(principal.userId);
  const preApproved = Boolean(approval && approval.registrationNumber === shape.normalised);
  const approvedBy = preApproved ? await approvals.approverOf(principal.userId) : null;

  const autoVerified = lookup.status === "verified" || preApproved;

  const db = getDb();
  let rows;
  try {
    rows = await db
      .insert(t.doctorVerifications)
      .values({
        userId: principal.userId,
        registrationNumber: shape.normalised!,
        registrationType: shape.type!,
        claimedName: String(input.name ?? principal.name),
        claimedSpecialtyId: input.specialtyId ? String(input.specialtyId) : null,
        claimedDegrees: input.degrees ? String(input.degrees) : null,
        claimedFacility: input.facility ? String(input.facility) : null,
        claimedDistrictId: input.districtId ? String(input.districtId) : null,
        claimedDivisionId: input.divisionId ? String(input.divisionId) : null,
        claimedExperienceYears: input.experienceYears ? Number(input.experienceYears) : null,
        // The form requires this and nothing used to keep it, so every approved
        // profile advertised ৳0 — see migration 0007.
        claimedFee: input.fee === undefined || input.fee === null || input.fee === ""
          ? null
          : String(Number(input.fee)),
        claimedAvailability: readClaimedAvailability(input.availability),
        contactEmail: principal.email,
        contactPhone: principal.phone,
        // Verified if a registry said so, or if an admin already approved
        // this exact number before the account existed. Anything else stays
        // pending. There is no third outcome.
        status: autoVerified ? "verified" : "pending",
        method: autoVerified ? (preApproved ? "manual_admin" : "bmdc_api") : null,
        decidedByUserId: preApproved ? approvedBy : null,
        lookupSource: lookup.source,
        lookupPayload: (lookup.record ?? null) as never,
        registerSaysName: preApproved ? approval!.registerName : null,
        ...(autoVerified ? { decidedAt: new Date() } : {}),
      })
      .returning({ id: t.doctorVerifications.id });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("ALREADY_EXISTS");
    throw err;
  }

  const applicationId = rows[0]!.id;

  // Confirmed by the registry, or already approved by an admin: either way the
  // number has been checked and the profile publishes. Everything else waits.
  if (autoVerified) {
    await publishProfile(
      applicationId,
      preApproved
        ? { verifiedByUserId: approvedBy, method: "manual_admin" }
        : { verifiedByUserId: null, method: "bmdc_api" },
    );
  }

  await audit({
    action: "doctor.verification_submit",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId: context.requestId,
    resourceType: "doctor_verification",
    resourceId: applicationId,
    metadata: { lookupSource: lookup.source, autoVerified, preApproved },
  });

  const queue = await listQueue();
  return {
    application: queue.find((a) => a.id === applicationId)!,
    lookup: { status: lookup.status, source: lookup.source },
  };
}

/* -------------------------------------------------------------------------- */
/* Decide                                                                      */
/* -------------------------------------------------------------------------- */

export async function decide(
  admin: Principal,
  input: { id?: unknown; approve?: unknown; adminNote?: unknown; verifiedName?: unknown },
  context: { requestId?: string },
): Promise<ApplicationView> {
  const id = String(input.id ?? "");
  const approve = Boolean(input.approve);
  if (!id) throw new AppError("VALIDATION_FAILED", { details: { id: ["Which application?"] } });

  const db = getDb();

  // Conditional on still being pending, so two admins clicking at once cannot
  // both record a decision.
  const decided = await db
    .update(t.doctorVerifications)
    .set({
      status: approve ? "verified" : "rejected",
      method: "manual_admin",
      decidedByUserId: admin.userId,
      decidedAt: new Date(),
      notes: input.adminNote ? String(input.adminNote).slice(0, 2000) : null,
      registerSaysName: input.verifiedName ? String(input.verifiedName) : null,
    })
    .where(and(eq(t.doctorVerifications.id, id), eq(t.doctorVerifications.status, "pending")))
    .returning({ id: t.doctorVerifications.id, userId: t.doctorVerifications.userId });

  if (!decided[0]) {
    throw new AppError("NOT_ELIGIBLE", {
      message: "That application has already been decided.",
    });
  }

  if (approve) {
    await publishProfile(id, { verifiedByUserId: admin.userId, method: "manual_admin" });
  }

  await audit({
    action: approve ? "doctor.verification_approve" : "doctor.verification_reject",
    actorUserId: admin.userId,
    actorRole: admin.role,
    requestId: context.requestId,
    resourceType: "doctor_verification",
    resourceId: id,
    subjectUserId: decided[0].userId,
  });

  if (decided[0].userId) {
    await clinical.notify({
      userId: decided[0].userId,
      type: approve ? "verification_approved" : "verification_rejected",
      title: approve ? "Your registration is verified" : "We couldn't verify your registration",
      body: approve
        ? "Your profile is now published and patients can book with you."
        : "An admin could not confirm your registration number. Please check it and reapply.",
      dedupeKey: `verification:${id}`,
    });
  }

  const queue = await listQueue();
  return queue.find((a) => a.id === id)!;
}

/* -------------------------------------------------------------------------- */
/* Publishing                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Turn an approved application into a bookable profile.
 *
 * The published profile is NOT a demo profile: it belongs to a real,
 * registry-checked practitioner and carries their registration number, which is
 * exactly what the schema's `ck_doctors_verified_has_evidence` requires.
 */
async function publishProfile(
  applicationId: string,
  decision: { verifiedByUserId: string | null; method: "manual_admin" | "bmdc_api" },
): Promise<string> {
  const db = getDb();

  const rows = await db
    .select()
    .from(t.doctorVerifications)
    .where(eq(t.doctorVerifications.id, applicationId))
    .limit(1);
  const application = rows[0];
  if (!application) throw new AppError("NOT_FOUND");

  const name = application.registerSaysName ?? application.claimedName;
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${applicationId.slice(0, 8)}`;

  const inserted = await db
    .insert(t.doctors)
    .values({
      userId: application.userId,
      displayName: name,
      initials: initialsOf(name),
      avatar: "teal",
      slug,
      primarySpecialtyId: application.claimedSpecialtyId ?? "general",
      degrees: application.claimedDegrees ?? "",
      experienceYears: application.claimedExperienceYears ?? 1,
      districtId: application.claimedDistrictId,
      divisionId: application.claimedDivisionId,
      /*
       * What they asked for. Absent only for an application filed before the
       * fee was stored at all; those keep the column default and the admin can
       * see the profile says ৳0 rather than the app inventing a number.
       */
      ...(application.claimedFee != null ? { feeAmount: application.claimedFee } : {}),
      bmdcNumber: application.registrationNumber,
      registrationType: application.registrationType,
      verificationStatus: "verified",
      verifiedAt: new Date(),
      registrationValidUntil: application.registerValidUntil,
      isDemoProfile: false,
      provenance: "bmdc_verified",
    })
    .onConflictDoNothing({ target: t.doctors.bmdcNumber })
    .returning({ id: t.doctors.id });

  const doctorId = inserted[0]?.id;
  if (!doctorId) {
    // A profile already exists for this registration number.
    throw new AppError("ALREADY_EXISTS", {
      message: "A profile already exists for that registration number.",
    });
  }

  await db.insert(t.doctorSpecialties).values({
    doctorId,
    specialtyId: application.claimedSpecialtyId ?? "general",
    isPrimary: true,
  });

  /*
   * Publish the hours the applicant gave. Without this a freshly approved
   * doctor has no availability rules, generateSlots returns nothing, and the
   * patient-facing profile reports "Fully booked for the next three weeks" —
   * a confident, specific and entirely false statement about a doctor who has
   * simply never been given any hours.
   *
   * Local minutes with the zone alongside, which is what the engine expects;
   * the timezone column defaults to Asia/Dhaka.
   */
  if (application.claimedAvailability.length) {
    await db.insert(t.doctorAvailability).values(
      application.claimedAvailability.map((rule) => ({
        doctorId,
        weekday: rule.weekday,
        startMinute: rule.startMinute,
        endMinute: rule.endMinute,
        slotMinutes: rule.slotMinutes,
        bufferMinutes: rule.bufferMinutes,
      })),
    );
  }

  await db
    .update(t.doctorVerifications)
    .set({ doctorId, method: decision.method })
    .where(eq(t.doctorVerifications.id, applicationId));

  return doctorId;
}

/* -------------------------------------------------------------------------- */
/* Suspension                                                                  */
/* -------------------------------------------------------------------------- */

/** Take a doctor out of the directory without deleting their history. */
export async function suspend(
  admin: Principal,
  doctorId: string,
  reason: string,
  context: { requestId?: string },
): Promise<void> {
  await getDb()
    .update(t.doctors)
    .set({
      verificationStatus: "suspended",
      suspendedAt: new Date(),
      suspensionReason: reason.slice(0, 500),
    })
    .where(eq(t.doctors.id, doctorId));

  await audit({
    action: "doctor.suspend",
    actorUserId: admin.userId,
    actorRole: admin.role,
    requestId: context.requestId,
    resourceType: "doctor",
    resourceId: doctorId,
  });
}
