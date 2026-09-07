/**
 * /api/waitlist — queue for a doctor on a full day.
 *
 * Scoped to the session's patient identity. The prototype's DELETE removed an
 * entry by raw id with no ownership check (finding S6).
 */
import { created, json, ok, query, withRoute } from "../../../lib/api/respond";
import { AppError } from "../../../lib/errors";
import { requirePatient } from "../../../lib/security/authz";
import { join, leave, listForPatient } from "../../../lib/services/waitlist";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/waitlist", async (request) => {
  const principal = await requirePatient(request);
  return ok({ entries: await listForPatient(principal.patientId) });
});

export const POST = withRoute("POST /api/waitlist", async (request, { requestId }) => {
  const principal = await requirePatient(request);
  const body = await json<Record<string, unknown>>(request, 4096);
  const id = await join(principal, body, { requestId });
  const entries = await listForPatient(principal.patientId);
  return created({ entry: entries.find((e) => e.id === id) ?? null, entries });
});

export const DELETE = withRoute("DELETE /api/waitlist", async (request) => {
  const principal = await requirePatient(request);
  const id = query(request).id;
  if (!id) throw new AppError("VALIDATION_FAILED", { details: { id: ["Which entry?"] } });

  await leave(principal, id);
  return ok({ entries: await listForPatient(principal.patientId) });
});
