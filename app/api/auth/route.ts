/**
 * /api/auth — the current session.
 *
 * GET is the only endpoint in the application that is happy to be called
 * without credentials: the client needs to be able to ask "am I signed in?" and
 * get a plain `{ user: null }` rather than a 401.
 */
import { json, ok, withRoute } from "../../../lib/api/respond";
import { clearAuthCookies, readCookie, SESSION_COOKIE, withCookies } from "../../../lib/auth/cookies";
import { getPrincipal, requireUser } from "../../../lib/security/authz";
import { logout, toPublicUser } from "../../../lib/services/auth";
import * as users from "../../../lib/repositories/users";
import { AppError } from "../../../lib/errors";
import { audit } from "../../../lib/audit";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/auth", async (request) => {
  const principal = await getPrincipal(request);
  if (!principal) return ok({ user: null });

  const user = await users.findById(principal.userId);
  if (!user) return withCookies(ok({ user: null }), clearAuthCookies());

  return ok({ user: toPublicUser(user, { patientId: principal.patientId }) });
});

/** PATCH — edit your own profile. Never anyone else's: the id is the session's. */
export const PATCH = withRoute("PATCH /api/auth", async (request, { requestId }) => {
  const principal = await requireUser(request);
  const body = await json<Record<string, unknown>>(request);

  const name = body.name === undefined ? undefined : String(body.name).trim();
  if (name !== undefined && !name) {
    throw new AppError("VALIDATION_FAILED", { details: { name: ["Please tell us your name."] } });
  }

  const updated = await users.updateProfile(principal.userId, {
    ...(name !== undefined ? { name } : {}),
    ...(body.phone !== undefined ? { phone: String(body.phone).trim() || null } : {}),
  });
  if (!updated) throw new AppError("NOT_FOUND");

  // Keep the clinical identity's display name in step with the account's.
  if (principal.patientId) {
    await users.updatePatient(principal.patientId, {
      ...(name !== undefined ? { displayName: name } : {}),
      ...(body.division !== undefined ? { divisionId: String(body.division) || null } : {}),
      ...(body.district !== undefined ? { districtId: String(body.district) || null } : {}),
    });
  }

  await audit({
    action: "profile.update",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId,
    resourceType: "user",
    resourceId: principal.userId,
    metadata: { fields: Object.keys(body) },
  });

  return ok({ user: toPublicUser(updated, { patientId: principal.patientId }) });
});

/** DELETE — sign out. Revokes the session server-side, not just the cookie. */
export const DELETE = withRoute("DELETE /api/auth", async (request, { requestId }) => {
  const principal = await getPrincipal(request);
  await logout(readCookie(request, SESSION_COOKIE), {
    ...(principal ? { userId: principal.userId } : {}),
    requestId,
  });
  return withCookies(ok({}), clearAuthCookies());
});
