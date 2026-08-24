import { listAppointments, bookAppointment } from "../../../lib/store.js";
import { boot, ok, fail, query, explain, patientIdFor } from "../_lib.js";

export const dynamic = "force-dynamic";

/** GET /api/appointments?patientId=&doctorId= */
export async function GET(request) {
  boot();
  const q = query(request);
  return ok({
    appointments: listAppointments({
      patientId: q.doctorId ? undefined : (q.patientId ?? patientIdFor(request)),
      doctorId: q.doctorId,
    }),
  });
}

/** POST /api/appointments — book a slot (conflict-free, see db/schema.sql). */
export async function POST(request) {
  boot();
  const body = await request.json();
  const result = bookAppointment({
    doctorId: body.doctorId,
    patientId: body.patientId ?? patientIdFor(request),
    startUtc: body.startUtc,
    forMember: body.forMember ?? null,
    reason: body.reason ?? "",
  });

  if (!result.ok) {
    return Response.json(
      { ok: false, reason: result.reason, message: explain(result.reason) },
      { status: result.reason === "slot_taken" ? 409 : 400 }
    );
  }
  return ok({ appointment: result.appointment }, { status: 201 });
}
