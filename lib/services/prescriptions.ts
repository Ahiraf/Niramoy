/**
 * Niramoy — prescribing
 * -----------------------------------------------------------------------------
 * The rule this module exists to enforce: a prescription may only be created by
 * the doctor who conducted the consultation it belongs to.
 *
 * Holding a doctor account is not, by itself, authority over a patient. The
 * treatment relationship is what grants it, and here that relationship is a
 * completed appointment between this doctor and this patient. A doctor with no
 * appointment for a patient cannot prescribe for them, which is also what stops
 * a compromised doctor account from writing prescriptions across the platform.
 *
 * AI never reaches this code. An AI-drafted summary lives in ai_visit_summaries
 * until a doctor reviews it, and medication text a model produced is not
 * accepted as a prescription item under any circumstances (brief §13).
 */

import { and, eq } from "drizzle-orm";

import { audit } from "../audit";
import { getDb } from "../db/client";
import * as t from "../db/schema";
import { AppError } from "../errors";
import * as clinical from "../repositories/clinical";
import type { Principal } from "../security/authz";

/** The doctor profile belonging to a signed-in doctor account. */
export async function doctorProfileForUser(
  userId: string,
): Promise<{ id: string; verificationStatus: string; displayName: string } | null> {
  const rows = await getDb()
    .select({
      id: t.doctors.id,
      verificationStatus: t.doctors.verificationStatus,
      displayName: t.doctors.displayName,
    })
    .from(t.doctors)
    .where(eq(t.doctors.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export interface PrescriptionInput {
  appointmentId?: unknown;
  diagnosis?: unknown;
  notes?: unknown;
  advice?: unknown;
  items?: unknown;
}

interface RawItem {
  medicine?: unknown;
  drug?: unknown;
  strength?: unknown;
  dose?: unknown;
  route?: unknown;
  frequency?: unknown;
  duration?: unknown;
  quantity?: unknown;
  instructions?: unknown;
}

const text = (value: unknown): string | null => {
  const s = String(value ?? "").trim();
  return s ? s : null;
};

export async function issuePrescription(
  principal: Principal,
  input: PrescriptionInput,
  context: { requestId?: string },
): Promise<{ id: string }> {
  const db = getDb();

  const doctor = await doctorProfileForUser(principal.userId);
  if (!doctor) {
    throw new AppError("FORBIDDEN", {
      message: "Your doctor profile isn't set up yet.",
      meta: { userId: principal.userId },
    });
  }
  if (doctor.verificationStatus !== "verified") {
    throw new AppError("NOT_VERIFIED", {
      message: "Your registration is still being verified, so you can't issue prescriptions yet.",
    });
  }

  const appointmentId = String(input.appointmentId ?? "");
  if (!appointmentId) {
    throw new AppError("VALIDATION_FAILED", {
      details: { appointmentId: ["A prescription must belong to a consultation."] },
    });
  }

  /**
   * The treatment relationship. Scoped to THIS doctor, so an appointment id
   * belonging to someone else's consultation resolves to nothing — the caller
   * cannot tell whether it does not exist or is not theirs, which is the
   * intended behaviour.
   */
  const rows = await db
    .select({
      id: t.appointments.id,
      patientId: t.appointments.patientId,
      status: t.appointments.status,
    })
    .from(t.appointments)
    .where(and(eq(t.appointments.id, appointmentId), eq(t.appointments.doctorId, doctor.id)))
    .limit(1);

  const appointment = rows[0];
  if (!appointment) {
    throw new AppError("NOT_FOUND", {
      message: "We couldn't find that consultation.",
      meta: { appointmentId, doctorId: doctor.id },
    });
  }

  if (!["in_progress", "completed"].includes(appointment.status)) {
    throw new AppError("NOT_ELIGIBLE", {
      message: "You can only prescribe for a consultation that has taken place.",
      meta: { status: appointment.status },
    });
  }

  const rawItems = Array.isArray(input.items) ? (input.items as RawItem[]) : [];
  const items = rawItems
    .map((item) => ({
      medicine: text(item.medicine ?? item.drug) ?? "",
      strength: text(item.strength),
      dose: text(item.dose),
      route: text(item.route),
      frequency: text(item.frequency),
      duration: text(item.duration),
      quantity: text(item.quantity),
      instructions: text(item.instructions),
    }))
    .filter((item) => item.medicine);

  if (!items.length) {
    throw new AppError("VALIDATION_FAILED", {
      details: { items: ["A prescription needs at least one medicine."] },
    });
  }

  const id = await clinical.createPrescription({
    patientId: appointment.patientId,
    doctorId: doctor.id,
    issuedByUserId: principal.userId,
    appointmentId: appointment.id,
    diagnosis: text(input.diagnosis),
    notes: text(input.notes),
    advice: text(input.advice),
    items,
  });

  // Mirrored into the record timeline so the patient sees it in their history.
  await clinical.createRecord({
    patientId: appointment.patientId,
    authorUserId: principal.userId,
    authorRole: "doctor",
    authorDisplayName: doctor.displayName,
    kind: "prescription",
    title: text(input.diagnosis) ?? "Prescription",
    body: text(input.notes),
    appointmentId: appointment.id,
  });

  await clinical.notify({
    userId: principal.userId,
    type: "prescription_ready",
    title: "Prescription issued",
    body: `A prescription was added to the consultation record.`,
    payload: { prescriptionId: id },
  });

  await audit({
    action: "prescription.create",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId: context.requestId,
    resourceType: "prescription",
    resourceId: id,
    // Item COUNT, never the medicines. An audit log records that a
    // prescription was written, not what was in it.
    metadata: { appointmentId: appointment.id, itemCount: items.length },
  });

  return { id };
}
