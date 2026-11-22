import { json, ok, withRoute } from "../../../../lib/api/respond";
import { listReviewsForModeration, moderateReview } from "../../../../lib/repositories/review-moderation";
import { requireAdmin } from "../../../../lib/security/authz";
import { AppError } from "../../../../lib/errors";
import { audit } from "../../../../lib/audit";

export const dynamic = "force-dynamic";
export const GET = withRoute("GET /api/admin/reviews", async (request) => {
  await requireAdmin(request);
  const reviews = await listReviewsForModeration();
  return ok({ reviews });
});

export const PATCH = withRoute("PATCH /api/admin/reviews", async (request, { requestId }) => {
  const admin = await requireAdmin(request);
  const body = await json<{ id?: string; approve?: boolean }>(request, 8192);
  if (!body.id || !/^[0-9a-f-]{36}$/i.test(body.id) || typeof body.approve !== "boolean") throw new AppError("VALIDATION_FAILED");
  await moderateReview(body.id, body.approve, admin.userId);
  await audit({ action: "review.moderate", actorUserId: admin.userId, actorRole: "admin", requestId, resourceType: "review", resourceId: body.id, metadata: { approved: body.approve } });
  return ok({ approved: body.approve });
});
