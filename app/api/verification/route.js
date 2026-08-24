import {
  listVerificationQueue, submitDoctorApplication, decideApplication,
} from "../../../lib/store.js";
import { verifyRegistration, validateRegistrationNumber, bmdcVerifyUrl } from "../../../lib/bmdc.js";
import { attachApplication, syncDoctorAccount } from "../../../lib/auth.js";
import { boot, ok, fail, sessionUser } from "../_lib.js";

export const dynamic = "force-dynamic";

/** Applications carry other people's identity documents — admins only. */
const requireAdmin = (request) =>
  sessionUser(request)?.role === "admin" ? null : fail("forbidden", 403);

/** GET /api/verification — the admin queue. */
export async function GET(request) {
  boot();
  return requireAdmin(request)
    ?? ok({ applications: listVerificationQueue(), bmdcVerifyUrl: bmdcVerifyUrl() });
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

  const applicant = sessionUser(request);

  const application = submitDoctorApplication({
    ...body,
    bmdcNumber: shape.normalised,
    registrationType: shape.type,
    userId: applicant?.id ?? null,
    lookup,
  });

  // A signed-in doctor's account follows the application's status from here on.
  if (applicant?.role === "doctor") attachApplication(applicant.id, application.id);

  return ok({ application, lookup }, { status: 201 });
}

/** PATCH /api/verification — admin approves or rejects. */
export async function PATCH(request) {
  boot();
  const denied = requireAdmin(request);
  if (denied) return denied;

  const body = await request.json();
  const result = decideApplication(body.id, {
    approve: Boolean(body.approve),
    adminNote: body.adminNote ?? "",
    verifiedName: body.verifiedName ?? null,
  });
  if (!result.ok) return fail(result.reason, 404);

  // Publish the decision onto the doctor's account so their workspace unlocks.
  syncDoctorAccount(result.entry.id, {
    status: result.entry.status,
    doctorId: result.doctor?.id ?? null,
  });

  return ok({ application: result.entry });
}
