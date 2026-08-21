import {
  cancelAppointment,
  rescheduleAppointment,
  completeAppointment,
} from "../../../../lib/store.js";
import { boot, ok, explain } from "../../_lib.js";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/appointments/:id
 * body: { action: "cancel" | "reschedule" | "complete", startUtc? }
 */
export async function PATCH(request, { params }) {
  boot();
  const { id } = await params;
  const body = await request.json();

  const result =
    body.action === "cancel" ? cancelAppointment(id)
    : body.action === "reschedule" ? rescheduleAppointment(id, body.startUtc)
    : body.action === "complete" ? completeAppointment(id)
    : { ok: false, reason: "unknown_action" };

  if (!result.ok) {
    return Response.json(
      { ok: false, reason: result.reason, message: explain(result.reason) },
      { status: 400 }
    );
  }
  return ok({ appointment: result.appointment });
}
