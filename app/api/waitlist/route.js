import { listWaitlist, joinWaitlist, leaveWaitlist, CURRENT_PATIENT } from "../../../lib/store.js";
import { boot, ok, query } from "../_lib.js";

export const dynamic = "force-dynamic";

/** GET /api/waitlist */
export async function GET(request) {
  boot();
  return ok({ entries: listWaitlist(query(request).patientId ?? CURRENT_PATIENT.id) });
}

/**
 * POST /api/waitlist — queue for a doctor on a full day. When a booked slot is
 * cancelled, the first person waiting gets a notification.
 */
export async function POST(request) {
  boot();
  const body = await request.json();
  return ok(
    { entry: joinWaitlist({ ...body, patientId: body.patientId ?? CURRENT_PATIENT.id }) },
    { status: 201 }
  );
}

/** DELETE /api/waitlist?id= */
export async function DELETE(request) {
  boot();
  return ok(leaveWaitlist(query(request).id));
}
