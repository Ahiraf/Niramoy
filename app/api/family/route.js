import { listFamily, addFamilyMember, removeFamilyMember } from "../../../lib/store.js";
import { boot, ok, query, patientIdFor } from "../_lib.js";

export const dynamic = "force-dynamic";

/** GET /api/family — people this account can book on behalf of. */
export async function GET(request) {
  boot();
  return ok({ members: listFamily(query(request).ownerId ?? patientIdFor(request)) });
}

/** POST /api/family */
export async function POST(request) {
  boot();
  const body = await request.json();
  return ok(
    { member: addFamilyMember({ ...body, ownerId: body.ownerId ?? patientIdFor(request) }) },
    { status: 201 }
  );
}

/** DELETE /api/family?id= */
export async function DELETE(request) {
  boot();
  return ok(removeFamilyMember(query(request).id));
}
