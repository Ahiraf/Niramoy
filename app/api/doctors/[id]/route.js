import { getDoctor, listReviews } from "../../../../lib/store.js";
import { boot, ok, fail } from "../../_lib.js";

export const dynamic = "force-dynamic";

/** GET /api/doctors/:id */
export async function GET(_request, { params }) {
  boot();
  const { id } = await params;
  const doctor = getDoctor(id);
  if (!doctor) return fail("doctor_not_found", 404);
  return ok({ doctor, reviews: listReviews(id) });
}
