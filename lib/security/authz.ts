/**
 * Niramoy — authentication and authorization
 * -----------------------------------------------------------------------------
 * Authentication answers "who is this?". Authorization answers "may they do
 * this, to this specific thing?". They are separate questions and this module
 * keeps them separate.
 *
 * The rule that fixes the prototype's central flaw: **the subject of a request
 * is derived from the session, never from the request.** There is no parameter
 * a caller can send that changes whose data they get. `?patientId=` is now
 * ignored entirely rather than preferred over the session, which is what made
 * every patient-scoped endpoint readable by anyone (finding S1).
 */

import { AppError } from "../errors";
import { getEnv } from "../config/env";
import { assertCsrf } from "../auth/csrf";
import { SESSION_COOKIE, readCookie } from "../auth/cookies";
import { hashToken } from "../auth/tokens";
import * as sessions from "../repositories/sessions";
import * as users from "../repositories/users";
import type { UserRole } from "../repositories/users";

export interface Principal {
  sessionId: string;
  userId: string;
  role: UserRole;
  name: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  /** The caller's own clinical identity. Null for doctors and admins. */
  patientId: string | null;
}

/**
 * Resolve the caller, or null when signed out.
 *
 * Also enforces CSRF on unsafe methods, because the CSRF secret lives on the
 * session row — checking it here means no handler can forget to.
 */
export async function getPrincipal(request: Request): Promise<Principal | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const session = await sessions.findByTokenHash(hashToken(token));
  if (!session) return null;

  assertCsrf(request, session.csrfSecret);

  const patient =
    session.user.role === "patient"
      ? await users.findPatientByUserId(session.user.id)
      : null;

  return {
    sessionId: session.sessionId,
    userId: session.user.id,
    role: session.user.role,
    name: session.user.name,
    email: session.user.email,
    phone: session.user.phone,
    emailVerified: Boolean(session.user.emailVerifiedAt),
    patientId: patient?.id ?? null,
  };
}

/** The caller, or 401. */
export async function requireUser(request: Request): Promise<Principal> {
  const principal = await getPrincipal(request);
  if (!principal) throw new AppError("UNAUTHENTICATED");
  return principal;
}

/** The caller, or 401/403 if they do not hold one of the given roles. */
export async function requireRole(
  request: Request,
  ...roles: UserRole[]
): Promise<Principal> {
  const principal = await requireUser(request);
  if (!roles.includes(principal.role)) {
    throw new AppError("FORBIDDEN", {
      meta: { required: roles, actual: principal.role, userId: principal.userId },
    });
  }
  return principal;
}

/**
 * A signed-in patient, with their clinical identity resolved.
 *
 * The `patientId` on the result is the ONLY value a patient-scoped query may be
 * keyed on. Nothing from the query string or body is consulted.
 */
export async function requirePatient(
  request: Request,
): Promise<Principal & { patientId: string }> {
  const principal = await requireRole(request, "patient");
  if (!principal.patientId) {
    // A patient account without a patient row is a data-integrity fault, not a
    // client error. Fail closed rather than inventing an identity.
    throw new AppError("INTERNAL", {
      meta: { reason: "patient_account_without_patient_row", userId: principal.userId },
    });
  }
  return principal as Principal & { patientId: string };
}

export async function requireAdmin(request: Request): Promise<Principal> {
  return requireRole(request, "admin");
}

export async function requireDoctor(request: Request): Promise<Principal> {
  return requireRole(request, "doctor");
}

/**
 * Assert that the caller owns a resource.
 *
 * Takes the owner id already read from the database. Callers must load the row
 * first and pass its real owner — never trust an id the client supplied.
 *
 * Admins are NOT granted a blanket override. An admin has no clinical reason to
 * read a patient's record, and giving the role a universal skeleton key is how
 * "authorized" quietly stops meaning anything. Admin powers are granted
 * endpoint by endpoint via requireAdmin.
 */
export function assertOwnership(
  principal: Principal,
  ownerId: string | null | undefined,
  context: { resource: string; resourceId?: string },
): void {
  if (!ownerId || ownerId !== principal.userId) {
    throw new AppError("FORBIDDEN", {
      meta: { ...context, userId: principal.userId },
    });
  }
}

/** As above, keyed on the caller's patient identity rather than their account. */
export function assertPatientOwnership(
  principal: Principal,
  ownerPatientId: string | null | undefined,
  context: { resource: string; resourceId?: string },
): void {
  if (!ownerPatientId || !principal.patientId || ownerPatientId !== principal.patientId) {
    throw new AppError("FORBIDDEN", {
      meta: { ...context, userId: principal.userId },
    });
  }
}

/**
 * A resource that does not exist and one the caller may not see should be
 * indistinguishable, otherwise 403-vs-404 enumerates ids. Use this when the
 * mere existence of the row is itself information.
 */
export function notFoundOrForbidden(context: { resource: string; resourceId?: string }): AppError {
  return new AppError("NOT_FOUND", { meta: context });
}

/**
 * The staff invite code gate for admin sign-up. Compared in constant time — a
 * plain `!==` leaks the code's prefix to a patient attacker.
 */
export function checkAdminInviteCode(supplied: unknown): boolean {
  const expected = getEnv().adminInviteCode;
  if (!expected) return false;

  const given = String(supplied ?? "");
  // Length is not secret; comparing unequal lengths in constant time is
  // unnecessary and Buffer.compare would throw.
  if (given.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** The client IP, from the platform's forwarding header. */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return request.headers.get("x-real-ip");
}
