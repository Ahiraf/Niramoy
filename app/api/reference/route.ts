/**
 * GET /api/reference — everything the filter UI needs in one round trip.
 */
import { ok, withRoute } from "../../../lib/api/respond";
import * as reference from "../../../lib/repositories/reference";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/reference", async () => {
  const [specialties, divisions, facilities, stats] = await Promise.all([
    reference.listSpecialties(),
    reference.listDivisions(),
    reference.listFacilities(),
    reference.platformStats(),
  ]);

  return ok({
    specialties,
    divisions,
    facilities,
    stats,
    languages: ["Bangla", "English", "Chittagonian", "Sylheti", "Rangpuri", "Barishali"],
  });
});
