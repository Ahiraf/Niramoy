import { listFamily, addFamilyMember, removeFamilyMember, CURRENT_PATIENT } from "../../../lib/store.js";
import { boot, ok, query } from "../_lib.js";

export const dynamic = "force-dynamic";

/** GET /api/family — people this account can book on behalf of. */
export async function GET(request) {
  boot();
  return ok({ members: listFamily(query(request).ownerId ?? CURRENT_PATIENT.id) });
}

/** POST /api/family */
export async function POST(request) {
  boot();
  const body = await request.json();
  return ok(
    { member: addFamilyMember({ ...body, ownerId: body.ownerId ?? CURRENT_PATIENT.id }) },
    { status: 201 }
  );
}

/** DELETE /api/family?id= */
export async function DELETE(request) {
  boot();
  return ok(removeFamilyMember(query(request).id));
}
