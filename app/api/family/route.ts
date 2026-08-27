/**
 * /api/family — the people this account may book on behalf of.
 *
 * Scoped to the session's user. The prototype's DELETE took an id from the
 * query string and removed it with no ownership check, so anyone could delete
 * anyone's family member (finding S6).
 *
 * Adding a dependent creates a patient identity for them. Being someone's
 * family is not by itself permission to read their medical history — the
 * default access level is `appointments_only` (brief §26).
 */
import { created, json, ok, query, withRoute } from "../../../lib/api/respond";
import { audit } from "../../../lib/audit";
import { AppError } from "../../../lib/errors";
import * as clinical from "../../../lib/repositories/clinical";
import * as users from "../../../lib/repositories/users";
import { requirePatient } from "../../../lib/security/authz";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/family", async (request) => {
  const principal = await requirePatient(request);
  return ok({ members: await clinical.listFamily(principal.userId) });
});

export const POST = withRoute("POST /api/family", async (request, { requestId }) => {
  const principal = await requirePatient(request);
  const body = await json<Record<string, unknown>>(request, 8192);

  const name = String(body.name ?? "").trim();
  const relation = String(body.relation ?? "").trim();
  if (!name || !relation) {
    throw new AppError("VALIDATION_FAILED", {
      details: {
        ...(name ? {} : { name: ["Enter the person's name."] }),
        ...(relation ? {} : { relation: ["How are they related to you?"] }),
      },
    });
  }

  const familyAccountId = await clinical.ensureFamilyAccount(principal.userId);

  // A dependent gets their own clinical identity, so their records are theirs
  // and survive being removed from the household.
  const patient = await users.createPatient({ userId: null, displayName: name });

  const id = await clinical.addFamilyMember({
    familyAccountId,
    patientId: patient.id,
    name,
    relation,
    gender: body.gender === undefined ? null : String(body.gender),
  });

  await audit({
    action: "family.add",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId,
    resourceType: "family_member",
    resourceId: id,
  });

  const members = await clinical.listFamily(principal.userId);
  return created({ member: members.find((m) => m.id === id) ?? null, members });
});

export const DELETE = withRoute("DELETE /api/family", async (request, { requestId }) => {
  const principal = await requirePatient(request);
  const id = query(request).id;
  if (!id) throw new AppError("VALIDATION_FAILED", { details: { id: ["Which member?"] } });

  // Load it scoped to the owner. An id belonging to someone else's household
  // resolves to nothing, and the caller cannot distinguish that from a
  // non-existent id.
  const member = await clinical.findFamilyMemberForOwner(id, principal.userId);
  if (!member) throw new AppError("NOT_FOUND");

  await clinical.removeFamilyMember(member.id);

  await audit({
    action: "family.remove",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId,
    resourceType: "family_member",
    resourceId: member.id,
  });

  return ok({ members: await clinical.listFamily(principal.userId) });
});
