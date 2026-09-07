/**
 * Niramoy — booking
 * -----------------------------------------------------------------------------
 * The transactional core of the platform.
 *
 * The design principle here is that **the pre-flight check is advisory and the
 * database is authoritative**. Generating slots and confirming the requested one
 * is free tells us nothing durable: between that read and our write, another
 * request can take it. So we do the read for a good error message, then attempt
 * the insert and let the exclusion constraint decide. A 23P01 is not an
 * exceptional condition — it is the expected outcome of a lost race, and it maps
 * to a clean 409.
 *
 * This is why brief §5's "never rely on frontend slot availability" is not
 * really about the frontend. A server-side pre-check has exactly the same flaw;
 * only the constraint closes it.
 */

import { audit } from "../audit";

import { isAppointmentConflict, isPatientDoubleBooking } from "../db/errors";
import { withRetry } from "../db/retry";
import { AppError } from "../errors";
import { logger } from "../observability/logger";
import * as appointments from "../repositories/appointments";
import * as clinical from "../repositories/clinical";
import * as directory from "../repositories/doctors";
import { canBook, canCancel, generateSlots, type Slot } from "../scheduling/engine";
import type { Principal } from "../security/authz";

const SLOT_HORIZON_DAYS = 60;

export interface DoctorSchedulingConfig {
  id: string;
  consultationMinutes: number;
  leadMinutes: number;
  cancelWindowMinutes: number;
  feeAmount: string;
  currency: string;
}

async function schedulingConfig(doctorId: string): Promise<DoctorSchedulingConfig | null> {
  const doctor = await directory.getDoctor(doctorId);
  if (!doctor) return null;

  const raw = await directory.getSchedulingConfig(doctorId);
  if (!raw) return null;

  return {
    id: doctorId,
    consultationMinutes: raw.consultationMinutes,
    leadMinutes: raw.leadMinutes,
    cancelWindowMinutes: raw.cancelWindowMinutes,
    feeAmount: String(doctor.fee),
    currency: "BDT",
  };
}

/** Bookable slots for a doctor over the next `days`. */
export async function availableSlots(
  doctorId: string,
  options: { days?: number; now?: Date } = {},
): Promise<Slot[]> {
  const now = options.now ?? new Date();
  const days = Math.min(SLOT_HORIZON_DAYS, Math.max(1, options.days ?? 14));

  const config = await schedulingConfig(doctorId);
  if (!config) throw new AppError("DOCTOR_NOT_FOUND");

  const rangeStart = new Date(now);
  const rangeEnd = new Date(now.getTime() + days * 86_400_000);

  const [rules, exceptions, booked] = await Promise.all([
    directory.getAvailability(doctorId),
    directory.getAvailabilityExceptions(doctorId, rangeStart, rangeEnd),
    appointments.bookedIntervals(doctorId, rangeStart, rangeEnd),
  ]);

  return generateSlots({
    rules,
    exceptions,
    booked,
    rangeStart,
    rangeEnd,
    now,
    leadMinutes: config.leadMinutes,
  });
}

export interface BookInput {
  doctorId?: unknown;
  startUtc?: unknown;
  reason?: unknown;
  /** Book on behalf of a dependent in the caller's household. */
  forMemberId?: unknown;
}

const reference = (): string =>
  `NRM-A-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296)
    .toString(36)
    .toUpperCase()
    .padStart(2, "0")}`;

export async function book(
  principal: Principal & { patientId: string },
  input: BookInput,
  context: { requestId?: string },
): Promise<appointments.AppointmentRow> {
  const doctorId = String(input.doctorId ?? "");
  if (!doctorId) {
    throw new AppError("VALIDATION_FAILED", { details: { doctorId: ["Pick a doctor."] } });
  }

  const config = await schedulingConfig(doctorId);
  if (!config) throw new AppError("DOCTOR_NOT_FOUND");

  const now = new Date();
  const requested = new Date(String(input.startUtc ?? ""));

  /**
   * Whose appointment is this? The dependent's own clinical identity when
   * booking for family, otherwise the caller's. Resolved from the database
   * scoped to the caller's household — a member id the caller does not own
   * simply does not resolve.
   */
  let patientId = principal.patientId;
  let familyMemberId: string | null = null;

  if (input.forMemberId) {
    const member = await clinical.findFamilyMemberForOwner(
      String(input.forMemberId),
      principal.userId,
    );
    if (!member) {
      throw new AppError("NOT_FOUND", { message: "We couldn't find that family member." });
    }
    patientId = member.patientId;
    familyMemberId = member.id;
  }

  // Advisory pre-check: produces a specific, useful error in the common case.
  const slots = await availableSlots(doctorId, { now, days: SLOT_HORIZON_DAYS });
  const existing = await appointments.patientIntervals(
    patientId,
    new Date(now.getTime() - 86_400_000),
    new Date(now.getTime() + SLOT_HORIZON_DAYS * 86_400_000),
  );

  const check = canBook({
    requestedStart: requested,
    availableSlots: slots,
    now,
    leadMinutes: config.leadMinutes,
    existing,
  });

  if (!check.ok) {
    throw new AppError(
      check.reason === "in_past"
        ? "BOOKING_IN_PAST"
        : check.reason === "too_soon"
          ? "BOOKING_TOO_SOON"
          : check.reason === "invalid_time"
            ? "INVALID_TIME"
            : check.reason === "overlaps_existing"
              ? "APPOINTMENT_CONFLICT"
              : "SLOT_UNAVAILABLE",
      {
        ...(check.reason === "overlaps_existing"
          ? { message: "You already have a consultation at that time." }
          : {}),
        meta: { reason: check.reason, doctorId },
      },
    );
  }

  const slot = check.slot!;

  // The authoritative attempt. The constraint, not the check above, decides.
  return withRetry(async () => {
    try {
      const appointment = await appointments.insert({
        reference: reference(),
        doctorId,
        patientId,
        bookedByUserId: principal.userId,
        familyMemberId,
        startUtc: slot.start,
        endUtc: slot.end,
        durationMinutes: slot.durationMinutes,
        reason: input.reason === undefined ? null : String(input.reason).slice(0, 2000),
        feeAmount: config.feeAmount,
        currency: config.currency,
      });

      await appointments.recordStatusChange({
        appointmentId: appointment.id,
        fromStatus: null,
        toStatus: "confirmed",
        changedByUserId: principal.userId,
        reasonCode: "booked",
      });

      await clinical.notify({
        userId: principal.userId,
        type: "appointment_confirmed",
        title: "Appointment confirmed",
        body: "Your consultation is booked.",
        payload: { appointmentId: appointment.id },
        dedupeKey: `appointment_confirmed:${appointment.id}`,
      });

      await audit({
        action: "appointment.create",
        actorUserId: principal.userId,
        actorRole: principal.role,
        requestId: context.requestId,
        resourceType: "appointment",
        resourceId: appointment.id,
        metadata: { doctorId, forFamilyMember: Boolean(familyMemberId) },
      });

      return appointment;
    } catch (err) {
      if (isAppointmentConflict(err)) {
        throw new AppError("APPOINTMENT_CONFLICT", {
          ...(isPatientDoubleBooking(err)
            ? { message: "You already have a consultation at that time." }
            : {}),
          meta: { doctorId, startUtc: slot.start.toISOString() },
        });
      }
      throw err;
    }
  }, { label: "book" });
}

/* -------------------------------------------------------------------------- */
/* Cancel                                                                      */
/* -------------------------------------------------------------------------- */

export async function cancel(
  principal: Principal,
  appointmentId: string,
  input: { reason?: unknown },
  context: { requestId?: string },
): Promise<appointments.AppointmentRow> {
  const appointment = await requireParticipation(principal, appointmentId);

  const config = await schedulingConfig(appointment.doctorId);
  const window = config?.cancelWindowMinutes ?? 60;

  // A doctor may cancel their own clinic at any time — a patient may not
  // cancel inside the notice window.
  if (principal.role === "patient" && !canCancel({
    appointmentStart: appointment.startUtc,
    cancelWindowMinutes: window,
  })) {
    throw new AppError("CANCEL_WINDOW_CLOSED", { meta: { window } });
  }

  const cancelled = await appointments.cancel(appointmentId, {
    byUserId: principal.userId,
    reason: input.reason === undefined ? null : String(input.reason).slice(0, 500),
  });
  if (!cancelled) {
    throw new AppError("NOT_ELIGIBLE", {
      message: "That appointment can no longer be cancelled.",
    });
  }

  await appointments.recordStatusChange({
    appointmentId,
    fromStatus: appointment.status,
    toStatus: "cancelled",
    changedByUserId: principal.userId,
    reasonCode: principal.role === "doctor" ? "doctor_cancelled" : "patient_cancelled",
  });

  await audit({
    action: "appointment.cancel",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId: context.requestId,
    resourceType: "appointment",
    resourceId: appointmentId,
  });

  // The freed slot may belong to someone waiting.
  await offerToWaitlist(appointment.doctorId, cancelled.startUtc, cancelled.endUtc).catch(
    (err: unknown) => logger.error("waitlist offer failed", { err, appointmentId }),
  );

  return cancelled;
}

/* -------------------------------------------------------------------------- */
/* Reschedule                                                                  */
/* -------------------------------------------------------------------------- */

export async function reschedule(
  principal: Principal,
  appointmentId: string,
  newStartUtc: unknown,
  context: { requestId?: string },
): Promise<appointments.AppointmentRow> {
  const appointment = await requireParticipation(principal, appointmentId);

  const config = await schedulingConfig(appointment.doctorId);
  if (!config) throw new AppError("DOCTOR_NOT_FOUND");

  const now = new Date();
  const requested = new Date(String(newStartUtc ?? ""));

  const slots = await availableSlots(appointment.doctorId, { now, days: SLOT_HORIZON_DAYS });
  const check = canBook({
    requestedStart: requested,
    availableSlots: slots,
    now,
    leadMinutes: config.leadMinutes,
  });
  if (!check.ok) {
    throw new AppError(check.reason === "slot_unavailable" ? "SLOT_UNAVAILABLE" : "INVALID_TIME", {
      meta: { reason: check.reason },
    });
  }

  const slot = check.slot!;
  const previousStart = appointment.startUtc;

  /**
   * A single UPDATE. The prototype cancelled the old appointment, booked a new
   * one, and restored the old status if the booking failed — a sequence that
   * loses the appointment entirely if the process dies in between, and detaches
   * any prescription linked to the original id. Moving the row is atomic: the
   * exclusion constraint evaluates the new interval, and a conflict rolls the
   * statement back with the appointment untouched.
   */
  const moved = await withRetry(async () => {
    try {
      return await appointments.move(appointmentId, {
        doctorId: appointment.doctorId,
        startUtc: slot.start,
        endUtc: slot.end,
        durationMinutes: slot.durationMinutes,
      });
    } catch (err) {
      if (isAppointmentConflict(err)) {
        throw new AppError("APPOINTMENT_CONFLICT");
      }
      throw err;
    }
  }, { label: "reschedule" });

  if (!moved) {
    throw new AppError("NOT_ELIGIBLE", {
      message: "That appointment can no longer be rescheduled.",
    });
  }

  await appointments.recordStatusChange({
    appointmentId,
    fromStatus: appointment.status,
    toStatus: moved.status,
    changedByUserId: principal.userId,
    reasonCode: "rescheduled",
  });

  await audit({
    action: "appointment.reschedule",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId: context.requestId,
    resourceType: "appointment",
    resourceId: appointmentId,
    metadata: { from: previousStart.toISOString(), to: slot.start.toISOString() },
  });

  await offerToWaitlist(appointment.doctorId, previousStart, appointment.endUtc).catch(
    (err: unknown) => logger.error("waitlist offer failed", { err, appointmentId }),
  );

  return moved;
}

/* -------------------------------------------------------------------------- */
/* Complete                                                                    */
/* -------------------------------------------------------------------------- */

/** Only the doctor may mark a consultation completed. */
export async function complete(
  principal: Principal,
  appointmentId: string,
  context: { requestId?: string },
): Promise<appointments.AppointmentRow> {
  const appointment = await requireParticipation(principal, appointmentId);

  if (principal.role !== "doctor") {
    throw new AppError("FORBIDDEN", {
      message: "Only the doctor can close a consultation.",
    });
  }

  const completed = await appointments.complete(appointmentId);
  if (!completed) throw new AppError("NOT_ELIGIBLE");

  await appointments.recordStatusChange({
    appointmentId,
    fromStatus: appointment.status,
    toStatus: "completed",
    changedByUserId: principal.userId,
    reasonCode: "doctor_completed",
  });

  await audit({
    action: "appointment.complete",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId: context.requestId,
    resourceType: "appointment",
    resourceId: appointmentId,
  });

  return completed;
}

/* -------------------------------------------------------------------------- */
/* Participation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Load an appointment and confirm the caller is a party to it.
 *
 * The prototype mutated appointments by id with no check at all, so anyone
 * could cancel anyone's consultation (finding S4). A non-participant gets
 * NOT_FOUND rather than FORBIDDEN, so appointment ids cannot be probed.
 */
export async function requireParticipation(
  principal: Principal,
  appointmentId: string,
): Promise<appointments.AppointmentRow> {
  const appointment = await appointments.findById(appointmentId);
  if (!appointment) throw new AppError("NOT_FOUND");

  if (principal.role === "patient") {
    // Either their own appointment, or one they booked for a dependent.
    const ownsAsPatient = principal.patientId && appointment.patientId === principal.patientId;
    const bookedIt = appointment.bookedByUserId === principal.userId;
    if (!ownsAsPatient && !bookedIt) throw new AppError("NOT_FOUND");
    return appointment;
  }

  if (principal.role === "doctor") {
    const profile = await directory.getProfileForUser(principal.userId);
    if (!profile || profile.id !== appointment.doctorId) throw new AppError("NOT_FOUND");
    return appointment;
  }

  // An admin has no clinical role in a consultation.
  throw new AppError("NOT_FOUND");
}

/* -------------------------------------------------------------------------- */
/* Waitlist hand-off                                                           */
/* -------------------------------------------------------------------------- */

/** Implemented in lib/services/waitlist.ts; imported lazily to avoid a cycle. */
async function offerToWaitlist(doctorId: string, start: Date, end: Date): Promise<void> {
  const { offerFreedSlot } = await import("./waitlist");
  await offerFreedSlot(doctorId, start, end);
}

