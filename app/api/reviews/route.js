import { addReview, listReviews, CURRENT_PATIENT } from "../../../lib/store.js";
import { boot, ok, query, explain } from "../_lib.js";

export const dynamic = "force-dynamic";

/** GET /api/reviews?doctorId= */
export async function GET(request) {
  boot();
  return ok({ reviews: listReviews(query(request).doctorId) });
}

/** POST /api/reviews — one review per completed appointment. */
export async function POST(request) {
  boot();
  const body = await request.json();
  const result = addReview({ ...body, patientId: body.patientId ?? CURRENT_PATIENT.id });
  if (!result.ok) {
    return Response.json(
      { ok: false, reason: result.reason, message: explain(result.reason) },
      { status: 409 }
    );
  }
  return ok({ review: result.review }, { status: 201 });
}
