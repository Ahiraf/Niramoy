/**
 * /api/doctor/reviews — the signed-in doctor's published patient reviews.
 *
 * The doctor id is derived from the verified doctor's session rather than
 * accepted from the request, so this endpoint can never be used to read a
 * different doctor's review list.
 */
import { ok, withRoute } from "../../../../lib/api/respond";
import * as clinical from "../../../../lib/repositories/clinical";
import { requireVerifiedDoctor } from "../../../../lib/security/authz";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/doctor/reviews", async (request) => {
  const profile = await requireVerifiedDoctor(request);
  return ok({ reviews: await clinical.listReviews(profile.id) });
});
