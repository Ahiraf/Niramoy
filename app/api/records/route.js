import {
  listRecords, addRecord, listPrescriptions, addPrescription, CURRENT_PATIENT,
} from "../../../lib/store.js";
import { boot, ok, query } from "../_lib.js";

export const dynamic = "force-dynamic";

/** GET /api/records — the medical-history timeline plus prescriptions. */
export async function GET(request) {
  boot();
  const patientId = query(request).patientId ?? CURRENT_PATIENT.id;
  return ok({
    records: listRecords(patientId),
    prescriptions: listPrescriptions(patientId),
  });
}

/** POST /api/records — add a record, or a prescription when kind==="prescription". */
export async function POST(request) {
  boot();
  const body = await request.json();
  const patientId = body.patientId ?? CURRENT_PATIENT.id;

  if (body.kind === "prescription") {
    return ok({ prescription: addPrescription({ ...body, patientId }) }, { status: 201 });
  }
  return ok({ record: addRecord({ ...body, patientId }) }, { status: 201 });
}
