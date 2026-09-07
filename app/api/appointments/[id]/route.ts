/**
 * PATCH /api/appointments/:id — cancel, reschedule or complete.
 *
 * Every action loads the appointment and confirms the caller is a party to it
 * first. The prototype mutated by id with no check whatsoever, so any caller
 * could cancel any consultation on the platform (finding S4).
 */
import { json, ok, withRoute } from "../../../../lib/api/respond";
import { AppError } from "../../../../lib/errors";
import { requireUser } from "../../../../lib/security/authz";
import { cancel, complete, reschedule } from "../../../../lib/services/booking";

export const dynamic = "force-dynamic";

export const PATCH = withRoute(
  "PATCH /api/appointments/[id]",
  async (request, { requestId }, { params }: { params: Promise<{ id: string }> }) => {
    const principal = await requireUser(request);
    const { id } = await params;
    const body = await json<Record<string, unknown>>(request, 4096);

    switch (body.action) {
      case "cancel":
        return ok({ appointment: await cancel(principal, id, body, { requestId }) });
      case "reschedule":
        return ok({
          appointment: await reschedule(principal, id, body.startUtc, { requestId }),
        });
      case "complete":
        return ok({ appointment: await complete(principal, id, { requestId }) });
      default:
        throw new AppError("UNKNOWN_ACTION", { meta: { action: body.action } });
    }
  },
);
