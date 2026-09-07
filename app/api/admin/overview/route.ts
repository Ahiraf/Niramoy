/**
 * GET /api/admin/overview — platform health for the admin dashboard.
 *
 * Deliberately aggregate-only. An admin overview is a legitimate operational
 * need; browsing individual patients' data is not, so every figure here is a
 * count and nothing identifies a patient.
 */

import { ok, withRoute } from "../../../../lib/api/respond";
import { requireAdmin } from "../../../../lib/security/authz";
import { adminOverview } from "../../../../lib/repositories/admin";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/admin/overview", async (request) => {
  await requireAdmin(request);
  const overview = await adminOverview();
  return ok({ ...overview });
});

