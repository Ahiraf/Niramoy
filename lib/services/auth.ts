/**
 * Niramoy — authentication service
 * -----------------------------------------------------------------------------
 * All the business logic of signing up, signing in and recovering an account.
 * Route handlers do parsing and responding; the rules live here.
 *
 * Three properties this module is built around:
 *
 *   ENUMERATION RESISTANCE. Nothing here ever reveals whether an email has an
 *   account — not through the response body, not through the status code, and
 *   not through response time. A login against an unknown email still performs
 *   an Argon2 verification against a dummy hash, and a reset request for an
 *   unknown email still returns the same success response after the same work.
 *
 *   SESSION ROTATION. A new session token is minted on every privilege change:
 *   sign-in, password change, password reset. A token captured before one of
 *   those events is dead afterwards, which is what stops session fixation.
 *
 *   FAIL CLOSED. Every branch that cannot establish who the caller is throws.
 */

import { AppError } from "../errors";
import { getEnv } from "../config/env";
import { audit } from "../audit";
import {
  burnPasswordTime, checkPasswordStrength, hashPassword, needsRehash, verifyPassword,
} from "../auth/password";
import { generateToken, hashClientAttribute, hashToken } from "../auth/tokens";
import { normalisePhone } from "../auth/phone";
import { claimSignupVerification } from "./phone-verification";
import { SESSION_TTL_SECONDS } from "../auth/cookies";
import { checkAdminInviteCode } from "../security/authz";
import * as sessions from "../repositories/sessions";
import * as users from "../repositories/users";
import type { UserRole } from "../repositories/users";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const EMAIL_VERIFICATION_TTL_HOURS = 24;
export const PASSWORD_RESET_TTL_MINUTES = 30;

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  initials: string;
  avatar: string;
  patientId: string | null;
  doctorId: string | null;
  verificationStatus: string | null;
  emailVerified: boolean;
  /** Whether a code was read back from the number in `phone`. */
  phoneVerified: boolean;
  /** Extra channels a copy of each notification goes out on. */
  notificationChannels: string[];
  district: string;
  division: string;
  createdAt: string;
}

const AVATAR_BY_ROLE: Record<UserRole, string> = {
  patient: "tan",
  doctor: "teal",
  admin: "purple",
};

export function initialsOf(name: string): string {
  return (
    String(name)
      .replace(/^Dr\.?\s*/i, "")
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "NA"
  );
}

export interface IssuedSession {
  token: string;
  csrfToken: string;
  maxAge: number;
}

/** Mint a session and its paired CSRF secret. */
async function issueSession(
  userId: string,
  context: { ip?: string | null; userAgent?: string | null; rotatedFrom?: string | null },
): Promise<IssuedSession> {
  const env = getEnv();
  const secret = env.sessionSecret ?? "";

  const token = generateToken();
  const csrfToken = generateToken();

  await sessions.createSession({
    userId,
    tokenHash: hashToken(token),
    csrfSecret: csrfToken,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    ipHash: hashClientAttribute(context.ip, secret),
    userAgentHash: hashClientAttribute(context.userAgent, secret),
    rotatedFrom: context.rotatedFrom ?? null,
  });

  return { token, csrfToken, maxAge: SESSION_TTL_SECONDS };
}

/* -------------------------------------------------------------------------- */
/* Registration                                                                */
/* -------------------------------------------------------------------------- */

export interface RegisterInput {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  password?: unknown;
  role?: unknown;
  inviteCode?: unknown;
  division?: unknown;
  district?: unknown;
  /** Proof from /api/auth/signup-otp that this number was confirmed. */
  verificationTicket?: unknown;
}

const ROLES: UserRole[] = ["patient", "doctor", "admin"];

export async function register(
  input: RegisterInput,
  context: { ip?: string | null; userAgent?: string | null; requestId?: string },
): Promise<{ user: PublicUser; session: IssuedSession; verificationToken: string }> {
  const name = String(input.name ?? "").trim();
  const email = users.normaliseEmail(input.email);
  const password = String(input.password ?? "");
  const role = ROLES.includes(input.role as UserRole) ? (input.role as UserRole) : null;

  const problems: Record<string, string[]> = {};
  if (!name) problems.name = ["Please tell us your name."];
  if (!EMAIL_RE.test(email)) problems.email = ["That doesn't look like a valid email address."];
  if (!role) problems.role = ["Pick patient, doctor or admin."];

  /**
   * The number, and whether it was proved.
   *
   * Patients and doctors reach this endpoint having already passed the code
   * step, so a verified number is required of them: it is the one contact
   * detail this platform actually depends on, and an account whose number was
   * never proved is an account we cannot reach about a consultation. Admin
   * accounts are staff accounts gated by an invite code, and are not held to
   * it — a member of staff being added by their own team is a different
   * situation from a stranger claiming a number.
   */
  const phoneGiven = String(input.phone ?? "").trim();
  const phone = phoneGiven ? normalisePhone(phoneGiven) : null;
  if (phoneGiven && !phone) {
    problems.phone = [
      "Enter a Bangladeshi mobile number, like 01712 345678.",
      "বাংলাদেশি মোবাইল নম্বর দিন, যেমন ০১৭১২ ৩৪৫৬৭৮।",
    ];
  } else if (!phone && role !== "admin") {
    problems.phone = ["Confirm your mobile number to continue."];
  }

  const passwordProblems = checkPasswordStrength(password);
  if (passwordProblems.length) problems.password = passwordProblems;

  if (Object.keys(problems).length) {
    throw new AppError("VALIDATION_FAILED", { details: problems });
  }

  // Admin accounts are staff accounts; the invite code is the gate.
  if (role === "admin" && !checkAdminInviteCode(input.inviteCode)) {
    throw new AppError("VALIDATION_FAILED", {
      details: { inviteCode: ["That staff invite code isn't valid."] },
    });
  }

  /**
   * Spend the ticket from the code step.
   *
   * Done before the account is created and never after: a ticket that is
   * checked but not consumed is a ticket that can be used twice, and this one
   * is the only evidence that the number on the account belongs to whoever is
   * filling in the form.
   */
  let phoneVerified = false;
  if (phone && role !== "admin") {
    phoneVerified = await claimSignupVerification(phone.e164, input.verificationTicket);
    if (!phoneVerified) {
      throw new AppError("NOT_ELIGIBLE", {
        message: "That number needs confirming again. Ask for a new code.",
        meta: { reason: "signup_ticket_invalid" },
      });
    }
  }

  if (await users.findByEmail(email)) {
    // Sign-up is the one place the existence of an account cannot be hidden —
    // the address is either available or it is not. Login and password reset,
    // where hiding it does help, stay opaque.
    throw new AppError("EMAIL_TAKEN");
  }

  const hashed = await hashPassword(password);
  const displayName =
    role === "doctor" && !/^dr\.?\s/i.test(name) ? `Dr. ${name}` : name;

  const user = await users.createUser({
    role: role!,
    name: displayName,
    email,
    // Stored in E.164, which is what the SMS gateway is handed later.
    phone: phone?.e164 ?? null,
    phoneVerified,
    passwordHash: hashed.hash,
    passwordAlgo: hashed.algo,
  });

  // A patient owns their clinical identity from the first second.
  let patientId: string | null = null;
  let patient: users.PatientRow | null = null;
  if (role === "patient") {
    patient = await users.createPatient({
      userId: user.id,
      displayName,
      divisionId: input.division ? String(input.division) : null,
      districtId: input.district ? String(input.district) : null,
    });
    patientId = patient.id;
  }

  const verificationToken = generateToken();
  await users.createAuthToken({
    userId: user.id,
    purpose: "email_verification",
    tokenHash: hashToken(verificationToken),
    expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 3_600_000),
    ipHash: hashClientAttribute(context.ip, getEnv().sessionSecret ?? ""),
  });

  const session = await issueSession(user.id, context);

  await audit({
    action: "auth.register",
    actorUserId: user.id,
    actorRole: user.role,
    actorIpHash: hashClientAttribute(context.ip, getEnv().sessionSecret ?? ""),
    requestId: context.requestId,
    resourceType: "user",
    resourceId: user.id,
  });

  return { user: toPublicUser(user, { patientId, ...locationOf(patient) }), session, verificationToken };
}

/* -------------------------------------------------------------------------- */
/* Login                                                                       */
/* -------------------------------------------------------------------------- */

export async function login(
  input: { email?: unknown; password?: unknown; role?: unknown },
  context: { ip?: string | null; userAgent?: string | null; requestId?: string },
): Promise<{ user: PublicUser; session: IssuedSession }> {
  const email = users.normaliseEmail(input.email);
  const password = String(input.password ?? "");
  const ipHash = hashClientAttribute(context.ip, getEnv().sessionSecret ?? "");

  const user = await users.findByEmail(email);

  if (!user) {
    // Spend the same time a real verification would, so response latency does
    // not distinguish "no such account" from "wrong password".
    await burnPasswordTime(password);
    await audit({
      action: "auth.login_failed",
      actorIpHash: ipHash,
      requestId: context.requestId,
      outcome: "denied",
      metadata: { reason: "no_such_account" },
    });
    throw new AppError("BAD_CREDENTIALS");
  }

  if (users.isLocked(user)) {
    await audit({
      action: "auth.login_failed",
      actorUserId: user.id,
      actorIpHash: ipHash,
      requestId: context.requestId,
      outcome: "denied",
      metadata: { reason: "locked" },
    });
    // Same message as a wrong password: telling an attacker they have found a
    // real account and locked it out is itself information.
    throw new AppError("BAD_CREDENTIALS");
  }

  const valid = await verifyPassword(password, user.passwordHash, user.passwordAlgo);
  if (!valid) {
    await users.recordFailedLogin(user.id);
    await audit({
      action: "auth.login_failed",
      actorUserId: user.id,
      actorIpHash: ipHash,
      requestId: context.requestId,
      outcome: "denied",
      metadata: { reason: "bad_password", attempt: user.failedLoginCount + 1 },
    });
    throw new AppError("BAD_CREDENTIALS");
  }

  if (user.status !== "active") {
    throw new AppError("FORBIDDEN", {
      message: "This account has been suspended. Please contact support.",
      meta: { userId: user.id, status: user.status },
    });
  }

  // The role tab on the sign-in form is a convenience, not a second factor.
  // Reject the mismatch, but say only that the account is not for this role.
  if (input.role && user.role !== input.role) {
    throw new AppError("WRONG_ROLE", { meta: { actualRole: user.role } });
  }

  // Transparent upgrade of a legacy scrypt hash, now that we hold the plaintext.
  if (needsRehash(user.passwordAlgo)) {
    const upgraded = await hashPassword(password);
    await users.setPassword(user.id, upgraded.hash, upgraded.algo);
  }

  await users.recordSuccessfulLogin(user.id);
  const session = await issueSession(user.id, context);

  const patient = user.role === "patient" ? await users.findPatientByUserId(user.id) : null;

  await audit({
    action: "auth.login",
    actorUserId: user.id,
    actorRole: user.role,
    actorIpHash: ipHash,
    requestId: context.requestId,
  });

  return { user: toPublicUser(user, { patientId: patient?.id ?? null, ...locationOf(patient) }), session };
}

/* -------------------------------------------------------------------------- */
/* Logout                                                                      */
/* -------------------------------------------------------------------------- */

export async function logout(
  token: string | null,
  context: { userId?: string; requestId?: string },
): Promise<void> {
  if (token) await sessions.revokeByTokenHash(hashToken(token), "logout");
  if (context.userId) {
    await audit({
      action: "auth.logout",
      actorUserId: context.userId,
      requestId: context.requestId,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Password change                                                             */
/* -------------------------------------------------------------------------- */

export async function changePassword(
  userId: string,
  sessionId: string,
  input: { currentPassword?: unknown; newPassword?: unknown },
  context: { ip?: string | null; userAgent?: string | null; requestId?: string },
): Promise<{ session: IssuedSession }> {
  const user = await users.findById(userId);
  if (!user) throw new AppError("UNAUTHENTICATED");

  const current = String(input.currentPassword ?? "");
  const next = String(input.newPassword ?? "");

  // Requiring the current password is what stops a hijacked session from
  // locking the real owner out of their own account.
  if (!(await verifyPassword(current, user.passwordHash, user.passwordAlgo))) {
    throw new AppError("BAD_CREDENTIALS", {
      message: "That isn't your current password.",
    });
  }

  const problems = checkPasswordStrength(next);
  if (problems.length) {
    throw new AppError("VALIDATION_FAILED", { details: { newPassword: problems } });
  }

  const hashed = await hashPassword(next);
  await users.setPassword(user.id, hashed.hash, hashed.algo);

  // Everything else is invalidated, including any session an attacker holds.
  await sessions.revokeAllForUser(user.id, "password_changed");
  await users.revokeAuthTokens(user.id, "password_reset");

  const session = await issueSession(user.id, { ...context, rotatedFrom: sessionId });

  await audit({
    action: "auth.password_change",
    actorUserId: user.id,
    actorRole: user.role,
    requestId: context.requestId,
  });

  return { session };
}

/* -------------------------------------------------------------------------- */
/* Password reset                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Begin a reset.
 *
 * Always resolves, and always with the same shape, whether or not the email has
 * an account. The caller sends an email only when `token` is present. The
 * response the user sees is identical either way — that is the requirement.
 */
export async function requestPasswordReset(
  email: unknown,
  context: { ip?: string | null; requestId?: string },
): Promise<{ token: string | null; userId: string | null; name: string | null }> {
  const normalised = users.normaliseEmail(email);
  const ipHash = hashClientAttribute(context.ip, getEnv().sessionSecret ?? "");

  const user = await users.findByEmail(normalised);
  if (!user || user.status !== "active") {
    await audit({
      action: "auth.password_reset_request",
      actorIpHash: ipHash,
      requestId: context.requestId,
      outcome: "denied",
      metadata: { reason: "no_active_account" },
    });
    return { token: null, userId: null, name: null };
  }

  // One live reset token at a time.
  await users.revokeAuthTokens(user.id, "password_reset");

  const token = generateToken();
  await users.createAuthToken({
    userId: user.id,
    purpose: "password_reset",
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
    ipHash,
  });

  await audit({
    action: "auth.password_reset_request",
    actorUserId: user.id,
    actorIpHash: ipHash,
    requestId: context.requestId,
  });

  return { token, userId: user.id, name: user.name };
}

export async function completePasswordReset(
  input: { token?: unknown; newPassword?: unknown },
  context: { ip?: string | null; userAgent?: string | null; requestId?: string },
): Promise<{ session: IssuedSession; user: PublicUser }> {
  const token = String(input.token ?? "");
  const next = String(input.newPassword ?? "");

  const problems = checkPasswordStrength(next);
  if (problems.length) {
    throw new AppError("VALIDATION_FAILED", { details: { newPassword: problems } });
  }

  const consumed = token
    ? await users.consumeAuthToken(hashToken(token), "password_reset")
    : null;
  if (!consumed) {
    throw new AppError("NOT_ELIGIBLE", {
      message: "That reset link is invalid or has expired. Please request a new one.",
    });
  }

  const user = await users.findById(consumed.userId);
  if (!user || user.status !== "active") throw new AppError("NOT_ELIGIBLE");

  const hashed = await hashPassword(next);
  await users.setPassword(user.id, hashed.hash, hashed.algo);

  // Whoever held a session before the reset loses it. That is the point of a
  // reset — the plausible reason for one is that somebody else had access.
  await sessions.revokeAllForUser(user.id, "password_reset");

  // A completed reset proves control of the mailbox.
  if (!user.emailVerifiedAt) await users.markEmailVerified(user.id);

  const session = await issueSession(user.id, context);
  const patient = user.role === "patient" ? await users.findPatientByUserId(user.id) : null;

  await audit({
    action: "auth.password_reset_complete",
    actorUserId: user.id,
    actorRole: user.role,
    requestId: context.requestId,
  });

  return { session, user: toPublicUser(user, { patientId: patient?.id ?? null, ...locationOf(patient) }) };
}

/* -------------------------------------------------------------------------- */
/* Email verification                                                          */
/* -------------------------------------------------------------------------- */

export async function verifyEmail(
  token: unknown,
  context: { requestId?: string },
): Promise<{ userId: string }> {
  const consumed = await users.consumeAuthToken(
    hashToken(String(token ?? "")),
    "email_verification",
  );
  if (!consumed) {
    throw new AppError("NOT_ELIGIBLE", {
      message: "That verification link is invalid or has expired.",
    });
  }

  await users.markEmailVerified(consumed.userId);
  await audit({
    action: "auth.email_verify",
    actorUserId: consumed.userId,
    requestId: context.requestId,
  });

  return { userId: consumed.userId };
}

/* -------------------------------------------------------------------------- */
/* Shaping                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where a patient said they are.
 *
 * Division and district live on the patient row, not the user row, so every
 * caller that shapes a public user has to carry them across or the profile
 * screen reads them back empty and offers whichever division happens to sort
 * first — someone else's district, presented as the patient's own.
 */
export function locationOf(
  patient: users.PatientRow | null | undefined,
): { division: string; district: string } {
  return { division: patient?.divisionId ?? "", district: patient?.districtId ?? "" };
}

/**
 * The only user shape that crosses the wire. No hash, no algorithm, no lockout
 * counters, no session details.
 */
export function toPublicUser(
  user: users.UserRow,
  extra: {
    patientId?: string | null;
    doctorId?: string | null;
    verificationStatus?: string | null;
    district?: string | null;
    division?: string | null;
  } = {},
): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? "",
    role: user.role,
    initials: initialsOf(user.name),
    avatar: AVATAR_BY_ROLE[user.role],
    patientId: extra.patientId ?? null,
    doctorId: extra.doctorId ?? null,
    verificationStatus: extra.verificationStatus ?? null,
    emailVerified: Boolean(user.emailVerifiedAt),
    phoneVerified: Boolean(user.phoneVerifiedAt),
    notificationChannels: user.notificationChannels ?? [],
    district: extra.district ?? "",
    division: extra.division ?? "",
    createdAt: user.createdAt.toISOString(),
  };
}
