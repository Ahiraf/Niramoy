/**
 * Niramoy — reviews
 * -----------------------------------------------------------------------------
 * A review is a claim about a consultation that happened. Three things must be
 * true before one is accepted, and the prototype checked none of them:
 *
 *   1. The appointment exists.
 *   2. It belongs to the reviewing patient.
 *   3. It is completed — you cannot rate a visit that has not taken place, nor
 *      one you cancelled.
 *
 * A doctor or admin cannot create a review at all: the route requires a patient
 * principal, which no staff account has (brief §28).
 */

import { and, eq } from "drizzle-orm";

import { audit } from "../audit";
import { getDb } from "../db/client";
import * as t from "../db/schema";
import { isUniqueViolation } from "../db/errors";
import { AppError } from "../errors";
import * as clinical from "../repositories/clinical";
import type { Principal } from "../security/authz";

export async function submitReview(
  principal: Principal & { patientId: string },
  input: { appointmentId?: unknown; rating?: unknown; comment?: unknown },
  context: { requestId?: string },
): Promise<{ id: string }> {
  const appointmentId = String(input.appointmentId ?? "");
  const rating = Number(input.rating);

  if (!appointmentId) {
    throw new AppError("VALIDATION_FAILED", {
      details: { appointmentId: ["Which consultation are you reviewing?"] },
    });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new AppError("VALIDATION_FAILED", {
      details: { rating: ["Give a rating from 1 to 5."] },
    });
  }

  // Loaded scoped to the caller's own patient identity, so an appointment id
  // belonging to somebody else simply does not resolve.
  const rows = await getDb()
    .select({
      id: t.appointments.id,
      doctorId: t.appointments.doctorId,
      status: t.appointments.status,
    })
    .from(t.appointments)
    .where(
      and(
        eq(t.appointments.id, appointmentId),
        eq(t.appointments.patientId, principal.patientId),
      ),
    )
    .limit(1);

  const appointment = rows[0];
  if (!appointment) throw new AppError("NOT_FOUND");

  if (appointment.status !== "completed") {
    throw new AppError("NOT_ELIGIBLE", {
      message: "You can review a consultation once it has taken place.",
      meta: { status: appointment.status },
    });
  }

  try {
    const id = await clinical.createReview({
      appointmentId: appointment.id,
      patientId: principal.patientId,
      doctorId: appointment.doctorId,
      authorUserId: principal.userId,
      rating,
      comment: input.comment === undefined ? null : String(input.comment).slice(0, 2000),
    });

    await audit({
      action: "review.create",
      actorUserId: principal.userId,
      actorRole: principal.role,
      requestId: context.requestId,
      resourceType: "review",
      resourceId: id,
      metadata: { doctorId: appointment.doctorId, rating },
    });

    return { id };
  } catch (err) {
    // The unique index on appointment_id is the real guard — the check above
    // would let two simultaneous submissions through.
    if (isUniqueViolation(err, "uq_reviews_appointment")) {
      throw new AppError("ALREADY_REVIEWED");
    }
    throw err;
  }
}
