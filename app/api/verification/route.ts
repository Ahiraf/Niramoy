/**
 * /api/verification — the BM&DC workflow.
 *
 * GET and PATCH are admin-only: an application carries another person's
 * identity documents and registration details.
 */
import { created, json, ok, withRoute } from "../../../lib/api/respond";
import { requireAdmin, requireRole } from "../../../lib/security/authz";
import { enforceRateLimit } from "../../../lib/security/rate-limit";
import { apply, decide, listQueue, verifyUrl } from "../../../lib/services/verification";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/verification", async (request) => {
  await requireAdmin(request);
  return ok({ applications: await listQueue(), bmdcVerifyUrl: verifyUrl() });
});

/** POST — a signed-in doctor applies. This is the only way into the directory. */
export const POST = withRoute("POST /api/verification", async (request, { requestId }) => {
  const principal = await requireRole(request, "doctor");
  const body = await json<Record<string, unknown>>(request, 32 * 1024);
  const result = await apply(principal, body, { requestId });
  return created(result);
});

/** PATCH — an admin approves or rejects. */
export const PATCH = withRoute("PATCH /api/verification", async (request, { requestId }) => {
  const admin = await requireAdmin(request);
  await enforceRateLimit("admin-action", admin.userId);

  const body = await json<Record<string, unknown>>(request, 8192);
  return ok({ application: await decide(admin, body, { requestId }) });
});
