import { getSpecialties, getDivisions, getFacilities, platformStats } from "../../../lib/store.js";
import { boot, ok } from "../_lib.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/reference
 * Everything the filter UI needs in one round-trip: specialties, the 8
 * divisions with their districts, facilities, and directory coverage stats.
 */
export async function GET() {
  boot();
  return ok({
    specialties: getSpecialties(),
    divisions: getDivisions(),
    facilities: getFacilities(),
    stats: platformStats(),
    languages: ["Bangla", "English", "Chittagonian", "Sylheti", "Rangpuri", "Barishali"],
  });
}
