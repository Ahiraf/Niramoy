/**
 * /api/reviews
 *
 * GET is public — reviews are what the directory is for.
 *
 * POST requires an eligible completed appointment between this patient and this
 * doctor. The prototype checked only for a duplicate on appointmentId, and
 * never that the appointment existed, was completed, or belonged to the caller,
 * so anyone could post any rating against any doctor (finding S5).
 */
import { created, json, ok, query, withRoute } from "../../../lib/api/respond";
import { AppError } from "../../../lib/errors";
import * as clinical from "../../../lib/repositories/clinical";
import { requirePatient } from "../../../lib/security/authz";
import { enforceRateLimit } from "../../../lib/security/rate-limit";
import { submitReview } from "../../../lib/services/reviews";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/reviews", async (request) => {
  const doctorId = query(request).doctorId;
  if (!doctorId) throw new AppError("VALIDATION_FAILED", { details: { doctorId: ["Which doctor?"] } });
  return ok({ reviews: await clinical.listReviews(doctorId) });
});

export const POST = withRoute("POST /api/reviews", async (request, { requestId }) => {
  const principal = await requirePatient(request);
  await enforceRateLimit("review", principal.userId);

  const body = await json<Record<string, unknown>>(request, 8192);
  const review = await submitReview(principal, body, { requestId });
  return created({ review });
});
