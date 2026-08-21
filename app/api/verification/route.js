import {
  listVerificationQueue, submitDoctorApplication, decideApplication,
} from "../../../lib/store.js";
import { verifyRegistration, validateRegistrationNumber, bmdcVerifyUrl } from "../../../lib/bmdc.js";
import { boot, ok, fail } from "../_lib.js";

export const dynamic = "force-dynamic";

/** GET /api/verification — the admin queue. */
export async function GET() {
  boot();
  return ok({ applications: listVerificationQueue(), bmdcVerifyUrl: bmdcVerifyUrl() });
}

/**
 * POST /api/verification — a doctor applies to join.
 *
 * This is the ONLY way a real doctor enters the directory. The BM&DC number is
 * shape-checked, then looked up if an endpoint is configured; otherwise the
 * application lands in the admin queue for a human to confirm against
 * verify.bmdc.org.bd. It never auto-approves.
 */
export async function POST(request) {
  boot();
  const body = await request.json();

  const shape = validateRegistrationNumber(body.bmdcNumber, body.registrationType);
  if (!shape.ok) return fail(`bmdc_${shape.reason}`, 422);

  const lookup = await verifyRegistration(body.bmdcNumber, body.registrationType);

  const application = submitDoctorApplication({
    ...body,
    bmdcNumber: shape.normalised,
    registrationType: shape.type,
    lookup,
  });

  return ok({ application, lookup }, { status: 201 });
}

/** PATCH /api/verification — admin approves or rejects. */
export async function PATCH(request) {
  boot();
  const body = await request.json();
  const result = decideApplication(body.id, {
    approve: Boolean(body.approve),
    adminNote: body.adminNote ?? "",
    verifiedName: body.verifiedName ?? null,
  });
  if (!result.ok) return fail(result.reason, 404);
  return ok({ application: result.entry });
}
