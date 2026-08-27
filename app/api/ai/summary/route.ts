/**
 * POST /api/ai/summary — draft a visit summary.
 *
 * Doctor-only, and only for their own consultation. The prototype's version
 * required no authentication at all, so anyone could send arbitrary text to the
 * configured model on the platform's account.
 *
 * The draft is stored pending review. It is not a medical record and does not
 * become one until a doctor confirms it at PATCH /api/ai/summary/:id.
 */
import { created, json, withRoute } from "../../../../lib/api/respond";
import { requireRole } from "../../../../lib/security/authz";
import { enforceRateLimit } from "../../../../lib/security/rate-limit";
import { generateSummary } from "../../../../lib/services/ai";

export const dynamic = "force-dynamic";

export const POST = withRoute("POST /api/ai/summary", async (request, { requestId }) => {
  const principal = await requireRole(request, "doctor");
  await enforceRateLimit("ai-summary", principal.userId);

  const body = await json<Record<string, unknown>>(request, 64 * 1024);
  const { id, draft } = await generateSummary(principal, body, { requestId });

  return created({
    id,
    draft,
    // Stated in the response as well as the type and the CHECK constraint, so a
    // client cannot render this as finished.
    requiresReview: true,
  });
});
