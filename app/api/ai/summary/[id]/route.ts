/**
 * PATCH /api/ai/summary/:id — the doctor's decision on a draft.
 *
 * `action: "approve"` writes the reviewed content into the patient's record,
 * authored by the doctor. `action: "reject"` discards it and nothing reaches the
 * record. This is the ONLY path from an AI draft to a medical record.
 */
import { json, ok, withRoute } from "../../../../../lib/api/respond";
import { AppError } from "../../../../../lib/errors";
import { requireRole } from "../../../../../lib/security/authz";
import { approveSummary, rejectSummary } from "../../../../../lib/services/ai";

export const dynamic = "force-dynamic";

export const PATCH = withRoute(
  "PATCH /api/ai/summary/[id]",
  async (request, { requestId }, { params }: { params: Promise<{ id: string }> }) => {
    const principal = await requireRole(request, "doctor");
    const { id } = await params;
    const body = await json<Record<string, unknown>>(request, 64 * 1024);

    if (body.action === "approve") {
      const { recordId } = await approveSummary(principal, id, body, { requestId });
      return ok({ recordId, reviewStatus: body.edited ? "edited" : "approved" });
    }

    if (body.action === "reject") {
      await rejectSummary(principal, id, String(body.reason ?? ""), { requestId });
      return ok({ reviewStatus: "rejected" });
    }

    throw new AppError("UNKNOWN_ACTION", { meta: { action: body.action } });
  },
);
