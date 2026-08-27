/**
 * /api/records — the patient's medical history.
 *
 * The subject is the SESSION's patient id. The prototype read
 * `query.patientId ?? patientIdFor(request)`, preferring a client-supplied id
 * over the session, which let any caller read any patient's history by adding a
 * query parameter (finding S1). That parameter is now ignored entirely.
 */
import { created, json, ok, withRoute } from "../../../lib/api/respond";
import { audit } from "../../../lib/audit";
import { AppError } from "../../../lib/errors";
import * as clinical from "../../../lib/repositories/clinical";
import { requirePatient } from "../../../lib/security/authz";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/records", async (request, { requestId }) => {
  const principal = await requirePatient(request);

  const [records, prescriptions] = await Promise.all([
    clinical.listRecords(principal.patientId),
    clinical.listPrescriptions(principal.patientId),
  ]);

  // Reading a medical record is an audited event even when you own it.
  await audit({
    action: "record.read",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId,
    resourceType: "patient",
    resourceId: principal.patientId,
    metadata: { records: records.length, prescriptions: prescriptions.length },
  });

  return ok({ records, prescriptions });
});

/**
 * POST — add a record to your own history.
 *
 * A patient may file their own notes and results. They may NOT create a
 * prescription: the prototype accepted `kind: "prescription"` here and routed
 * it into the prescriptions table with no role check (finding S3).
 */
export const POST = withRoute("POST /api/records", async (request, { requestId }) => {
  const principal = await requirePatient(request);
  const body = await json<Record<string, unknown>>(request, 32 * 1024);

  if (body.kind === "prescription") {
    throw new AppError("FORBIDDEN", {
      message: "Only a doctor can issue a prescription.",
      meta: { attempted: "patient_self_prescription", userId: principal.userId },
    });
  }

  const title = String(body.title ?? "").trim();
  if (!title) {
    throw new AppError("VALIDATION_FAILED", { details: { title: ["Give the record a title."] } });
  }

  const kind = ["note", "lab", "imaging", "upload"].includes(String(body.kind))
    ? (String(body.kind) as "note" | "lab" | "imaging" | "upload")
    : "note";

  const record = await clinical.createRecord({
    patientId: principal.patientId,
    authorUserId: principal.userId,
    authorRole: "patient",
    authorDisplayName: principal.name,
    kind,
    title,
    body: body.note === undefined ? null : String(body.note),
  });

  await audit({
    action: "record.create",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId,
    resourceType: "medical_record",
    resourceId: record.id,
  });

  return created({ record });
});
