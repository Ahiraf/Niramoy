/**
 * GET /api/doctors — search the verified directory.
 *
 * Public: finding a doctor should not require an account. Only verified,
 * unsuspended profiles are returned, and no private column (the BM&DC number in
 * particular) is in the selected set.
 */
import { ok, query, withRoute } from "../../../lib/api/respond";
import * as directory from "../../../lib/repositories/doctors";
import { clientIp } from "../../../lib/security/authz";
import { enforceRateLimit } from "../../../lib/security/rate-limit";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/doctors", async (request) => {
  // Public and paginated, so it is a scraping surface as well as a query one.
  await enforceRateLimit("doctor-search", clientIp(request) ?? "unknown");

  const { doctors, total, page, perPage } = await directory.searchDoctors(query(request));
  return ok({ doctors, total, page, perPage });
});
