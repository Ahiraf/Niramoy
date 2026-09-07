/**
 * /api/prescriptions
 *
 * GET  — your own prescriptions (patient), scoped to the session.
 * POST — issue one. DOCTORS ONLY.
 *
 * The prototype's POST had no role check at all, so a patient could write
 * themselves a prescription (finding S3). Beyond the role, the doctor must be
 * the doctor on the appointment being prescribed against — holding a doctor
 * account is not authority over an arbitrary patient.
 */
import { created, json, ok, withRoute } from "../../../lib/api/respond";
import { audit } from "../../../lib/audit";

import * as clinical from "../../../lib/repositories/clinical";
import { requirePatient, requireRole } from "../../../lib/security/authz";
import { issuePrescription } from "../../../lib/services/prescriptions";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/prescriptions", async (request, { requestId }) => {
  const principal = await requirePatient(request);
  const prescriptions = await clinical.listPrescriptions(principal.patientId);

  await audit({
    action: "prescription.read",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId,
    resourceType: "patient",
    resourceId: principal.patientId,
    metadata: { count: prescriptions.length },
  });

  return ok({ prescriptions });
});

export const POST = withRoute("POST /api/prescriptions", async (request, { requestId }) => {
  const principal = await requireRole(request, "doctor");
  const body = await json<Record<string, unknown>>(request, 64 * 1024);

  const prescription = await issuePrescription(principal, body, { requestId });
  return created({ prescription });
});

