import { triage, matchDoctors, assistantReply } from "../../../../lib/ai.js";
import { searchDoctors, CURRENT_PATIENT } from "../../../../lib/store.js";
import { DISTRICTS } from "../../../../lib/data/geo.js";
import { boot, ok } from "../../_lib.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/triage
 * body: { message, district?, division?, maxFee? }
 *
 * Runs symptom triage, then ranks matching doctors. Red-flag symptoms return an
 * emergency result and are never passed to a model.
 */
export async function POST(request) {
  boot();
  const body = await request.json();
  const result = await triage(body.message);

  // Derive the division from the district when only a district is given —
  // otherwise the patient's default division would fight their explicit choice.
  const district = body.district ?? CURRENT_PATIENT.district;
  const division =
    body.division ??
    (body.district
      ? DISTRICTS.find((d) => d.name === body.district)?.division
      : CURRENT_PATIENT.division);

  const preferences = { district, division, maxFee: body.maxFee };

  // An emergency gets advice, not a booking funnel.
  const matches = result.redFlag
    ? []
    : matchDoctors(result, searchDoctors({ sort: "best" }), preferences);

  return ok({
    triage: result,
    reply: assistantReply(body.message, result),
    matches,
  });
}
