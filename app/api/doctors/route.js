import { searchDoctors } from "../../../lib/store.js";
import { boot, ok, query } from "../_lib.js";

export const dynamic = "force-dynamic";

/** GET /api/doctors?search=&specialty=&division=&district=&maxFee=&sort= */
export async function GET(request) {
  boot();
  const q = query(request);
  const doctors = searchDoctors(q);
  const page = Number(q.page ?? 1);
  const perPage = Number(q.perPage ?? 24);

  return ok({
    total: doctors.length,
    page,
    perPage,
    doctors: doctors.slice((page - 1) * perPage, page * perPage),
  });
}
