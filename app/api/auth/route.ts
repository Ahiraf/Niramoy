/**
 * /api/auth — the current session.
 *
 * GET is the only endpoint in the application that is happy to be called
 * without credentials: the client needs to be able to ask "am I signed in?" and
 * get a plain `{ user: null }` rather than a 401.
 */
import { json, ok, withRoute } from "../../../lib/api/respond";
import { clearAuthCookies, readCookie, SESSION_COOKIE, withCookies } from "../../../lib/auth/cookies";
import { normalisePhone } from "../../../lib/auth/phone";
import { getPrincipal, requireUser } from "../../../lib/security/authz";
import { locationOf, logout, toPublicUser } from "../../../lib/services/auth";
import * as users from "../../../lib/repositories/users";
import { AppError } from "../../../lib/errors";
import { audit } from "../../../lib/audit";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/auth", async (request) => {
  const principal = await getPrincipal(request);
  if (!principal) return ok({ user: null });

  const user = await users.findById(principal.userId);
  if (!user) return withCookies(ok({ user: null }), clearAuthCookies());

  const patient = principal.patientId ? await users.findPatientByUserId(principal.userId) : null;

  return ok({ user: toPublicUser(user, { patientId: principal.patientId, ...locationOf(patient) }) });
});

/**
 * The channels a person may choose. Mirrors ck_users_notification_channels.
 * `sms` and `whatsapp` are storable but have no provider yet, so choosing one
 * records the preference and delivers nothing — the settings screen says so.
 */
const NOTIFICATION_CHANNELS = ["email", "sms", "whatsapp"];

/** PATCH — edit your own profile. Never anyone else's: the id is the session's. */
export const PATCH = withRoute("PATCH /api/auth", async (request, { requestId }) => {
  const principal = await requireUser(request);
  const body = await json<Record<string, unknown>>(request);

  const name = body.name === undefined ? undefined : String(body.name).trim();
  if (name !== undefined && !name) {
    throw new AppError("VALIDATION_FAILED", { details: { name: ["Please tell us your name."] } });
  }

  /*
   * Notification channels. `in_app` is not one of them and cannot be turned
   * off — the notification row is the record that we told the patient, and the
   * platform needs it whether or not they read it. Unknown values are rejected
   * here as well as by a CHECK constraint, so a typo fails at the edge with a
   * readable message rather than at the database with a 500.
   */
  let notificationChannels: string[] | undefined;
  if (body.notificationChannels !== undefined) {
    const raw = Array.isArray(body.notificationChannels) ? body.notificationChannels : [];
    const cleaned = [...new Set(raw.map((c) => String(c)))];
    const unknown = cleaned.filter((c) => !NOTIFICATION_CHANNELS.includes(c));
    if (unknown.length) {
      throw new AppError("VALIDATION_FAILED", {
        details: { notificationChannels: [`Unknown channel: ${unknown.join(", ")}`] },
      });
    }
    notificationChannels = cleaned;
  }

  /*
   * A number that is given must be one we can send to, in the one shape the
   * gateway accepts. Editing it also un-verifies it — that happens inside the
   * update statement — so any code already in flight is for a number this
   * account no longer claims, and is revoked below.
   */
  let phone: string | null | undefined;
  if (body.phone !== undefined) {
    const raw = String(body.phone ?? "").trim();
    const parsed = raw ? normalisePhone(raw) : null;
    if (raw && !parsed) {
      throw new AppError("VALIDATION_FAILED", {
        details: {
          phone: [
            "Enter a Bangladeshi mobile number, like 01712 345678.",
            "বাংলাদেশি মোবাইল নম্বর দিন, যেমন ০১৭১২ ৩৪৫৬৭৮।",
          ],
        },
      });
    }
    phone = parsed?.e164 ?? null;
  }

  const before = phone !== undefined ? await users.findById(principal.userId) : null;

  const updated = await users.updateProfile(principal.userId, {
    ...(name !== undefined ? { name } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(notificationChannels !== undefined ? { notificationChannels } : {}),
  });
  if (!updated) throw new AppError("NOT_FOUND");

  if (before && before.phone !== updated.phone) {
    await users.revokeAuthTokens(principal.userId, "phone_verification");
  }

  // Keep the clinical identity's display name in step with the account's.
  let patient: users.PatientRow | null = null;
  if (principal.patientId) {
    await users.updatePatient(principal.patientId, {
      ...(name !== undefined ? { displayName: name } : {}),
      ...(body.division !== undefined ? { divisionId: String(body.division) || null } : {}),
      ...(body.district !== undefined ? { districtId: String(body.district) || null } : {}),
    });
    // Read back rather than echo the request: the response is what the form
    // re-renders from, and it should show what was stored.
    patient = await users.findPatientByUserId(principal.userId);
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

  return ok({ user: toPublicUser(updated, { patientId: principal.patientId, ...locationOf(patient) }) });
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
