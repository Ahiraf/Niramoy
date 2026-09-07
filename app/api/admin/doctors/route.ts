/**
 * /api/admin/doctors — the directory, including profiles a patient cannot see.
 *
 * PATCH suspends or reinstates. Suspension removes a doctor from the directory
 * without deleting anything: their consultations and the records attached to
 * them are retained (brief §30).
 */
import { json, ok, query, withRoute } from "../../../../lib/api/respond";
import { AppError } from "../../../../lib/errors";
import { requireAdmin } from "../../../../lib/security/authz";
import { enforceRateLimit } from "../../../../lib/security/rate-limit";
import { adminDoctorList, reinstateDoctor } from "../../../../lib/repositories/admin";
import { suspend } from "../../../../lib/services/verification";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/admin/doctors", async (request) => {
  await requireAdmin(request);
  const q = query(request);
  const { doctors, total } = await adminDoctorList({ status: q.status, search: q.search });
  return ok({ doctors, total });
});

export const PATCH = withRoute("PATCH /api/admin/doctors", async (request, { requestId }) => {
  const admin = await requireAdmin(request);
  await enforceRateLimit("admin-action", admin.userId);

  const body = await json<Record<string, unknown>>(request, 4096);
  const doctorId = String(body.doctorId ?? "");
  if (!doctorId) {
    throw new AppError("VALIDATION_FAILED", { details: { doctorId: ["Which doctor?"] } });
  }

  if (body.action === "suspend") {
    const reason = String(body.reason ?? "").trim();
    if (!reason) {
      // A suspension without a recorded reason is not auditable.
      throw new AppError("VALIDATION_FAILED", {
        details: { reason: ["Record why this doctor is being suspended."] },
      });
    }
    await suspend(admin, doctorId, reason, { requestId });
    return ok({ doctorId, status: "suspended" });
  }

  if (body.action === "reinstate") {
    await reinstateDoctor(admin, doctorId, { requestId });
    return ok({ doctorId, status: "verified" });
  }

  throw new AppError("UNKNOWN_ACTION", { meta: { action: body.action } });
});
