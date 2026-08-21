import { listPrescriptions, addPrescription, CURRENT_PATIENT } from "../../../lib/store.js";
import { boot, ok, query } from "../_lib.js";

export const dynamic = "force-dynamic";

/** GET /api/prescriptions?patientId= */
export async function GET(request) {
  boot();
  return ok({ prescriptions: listPrescriptions(query(request).patientId ?? CURRENT_PATIENT.id) });
}

/** POST /api/prescriptions — issued by a doctor after a consultation. */
export async function POST(request) {
  boot();
  const body = await request.json();
  return ok(
    { prescription: addPrescription({ ...body, patientId: body.patientId ?? CURRENT_PATIENT.id }) },
    { status: 201 }
  );
}
