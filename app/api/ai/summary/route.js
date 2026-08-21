import { summariseVisit } from "../../../../lib/ai.js";
import { boot, ok } from "../../_lib.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/summary
 * Drafts a visit summary. Always returned with requiresReview: true — the
 * doctor confirms it before it is written to the patient's record.
 */
export async function POST(request) {
  boot();
  const body = await request.json();
  return ok({ draft: await summariseVisit(body) });
}
