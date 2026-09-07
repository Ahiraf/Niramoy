/**
 * /api/appointments
 *
 * The subject is the session: a patient sees their own, a doctor sees their
 * clinic. There is no parameter that changes whose appointments you get — the
 * prototype accepted `?patientId=` and `?doctorId=` from the client (finding
 * S1).
 */
import { created, json, ok, withRoute } from "../../../lib/api/respond";

import * as appointments from "../../../lib/repositories/appointments";
import * as directory from "../../../lib/repositories/doctors";
import { requireUser, requirePatient } from "../../../lib/security/authz";
import { enforceRateLimit } from "../../../lib/security/rate-limit";
import { book } from "../../../lib/services/booking";
import { canCancel } from "../../../lib/scheduling/engine";
import { describeSlot, timezoneLabel } from "../../../lib/scheduling/engine";
import { getEnv } from "../../../lib/config/env";

export const dynamic = "force-dynamic";

/** Adds the display fields the existing appointment cards render. */
function hydrate(row: appointments.HydratedAppointment) {
  const described = describeSlot(
    {
      start: new Date(row.startUtc),
      end: new Date(row.endUtc),
      durationMinutes: row.durationMinutes,
    },
    getEnv().DISPLAY_TIMEZONE,
  );
  return {
    ...row,
    ...described,
    time: described.localLabel,
    fee: Number(row.feeAmount),
    canCancel: canCancel({ appointmentStart: row.startUtc }),
    // Which clock the time above refers to. Sent from the server because the
    // server owns DISPLAY_TIMEZONE; a browser guessing from its own locale is
    // how a relative abroad reads a Dhaka appointment in their own time.
    timezone: getEnv().DISPLAY_TIMEZONE,
    timezoneLabel: timezoneLabel(getEnv().DISPLAY_TIMEZONE, new Date(row.startUtc)),
  };
}

export const GET = withRoute("GET /api/appointments", async (request) => {
  const principal = await requireUser(request);

  if (principal.role === "doctor") {
    const profile = await directory.getProfileForUser(principal.userId);
    if (!profile) return ok({ appointments: [] });
    const rows = await appointments.list({ doctorId: profile.id });
    return ok({ appointments: rows.map(hydrate) });
  }

  if (principal.role === "patient" && principal.patientId) {
    const rows = await appointments.list({ patientId: principal.patientId });
    return ok({ appointments: rows.map(hydrate) });
  }

  // An admin has no clinical appointment list of their own.
  return ok({ appointments: [] });
});

/** POST — book a slot. Transactional; the database adjudicates conflicts. */
export const POST = withRoute("POST /api/appointments", async (request, { requestId }) => {
  const principal = await requirePatient(request);
  await enforceRateLimit("appointment-book", principal.userId);

  const body = await json<Record<string, unknown>>(request, 8192);
  const appointment = await book(principal, body, { requestId });

  const rows = await appointments.list({ patientId: principal.patientId });
  const hydrated = rows.find((r) => r.id === appointment.id);

  return created({ appointment: hydrated ? hydrate(hydrated) : appointment });
});

