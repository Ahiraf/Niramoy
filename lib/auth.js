/**
 * Niramoy — accounts, passwords and sessions
 * -----------------------------------------------------------------------------
 * Three roles share one account table, exactly as db/schema.sql models it:
 *
 *    patient  — signs up freely, gets an empty workspace of their own
 *    doctor   — signs up with a BM&DC registration number; the account exists
 *               immediately but stays `pending` until an admin verifies the
 *               number at verify.bmdc.org.bd (see lib/bmdc.js). Only then is a
 *               bookable profile published and linked back to the account.
 *    admin    — cannot self-serve; sign-up requires the staff invite code.
 *
 * Like lib/store.js this is in-memory today and is the single swap point: move
 * the bodies to SQL and neither the routes nor the UI change. Passwords are
 * hashed with scrypt and compared in constant time — never stored in clear,
 * never returned to the client.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { VERIFICATION_STATUS } from "./bmdc.js";
import { CURRENT_PATIENT } from "./store.js";

const auth = globalThis.__niramoyAuth ?? (globalThis.__niramoyAuth = {
  users: [],      // users
  sessions: [],   // sessions
  seq: 1,
});

export const ROLES = ["patient", "doctor", "admin"];

export const SESSION_COOKIE = "niramoy_session";
const SESSION_DAYS = 7;

/** Staff invite code. Set NIRAMOY_ADMIN_CODE in production. */
const ADMIN_CODE = process.env.NIRAMOY_ADMIN_CODE || "NIRAMOY-ADMIN";

/* -------------------------------------------------------------------------- */
/* Passwords                                                                   */
/* -------------------------------------------------------------------------- */

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordMatches(password, stored) {
  const [salt, digest] = String(stored).split(":");
  if (!salt || !digest) return false;
  const a = Buffer.from(digest, "hex");
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Password policy, checked on the server so the client can't skip it. */
export function checkPassword(password) {
  if (!password || password.length < 8) return { ok: false, reason: "password_too_short" };
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, reason: "password_too_simple" };
  }
  return { ok: true };
}

export function normaliseEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* -------------------------------------------------------------------------- */
/* Shaping                                                                     */
/* -------------------------------------------------------------------------- */

const initialsOf = (name) =>
  String(name).replace(/^Dr\.?\s*/i, "").split(/\s+/).filter(Boolean)
    .map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "NA";

const AVATAR_BY_ROLE = { patient: "tan", doctor: "teal", admin: "purple" };

/** The only user shape that ever crosses the wire — no hash, no salt. */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? "",
    role: user.role,
    initials: user.initials,
    avatar: user.avatar,
    patientId: user.patientId ?? null,
    doctorId: user.doctorId ?? null,
    applicationId: user.applicationId ?? null,
    verificationStatus: user.verificationStatus ?? null,
    district: user.district ?? "",
    division: user.division ?? "",
    createdAt: user.createdAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Accounts                                                                    */
/* -------------------------------------------------------------------------- */

export function findUserByEmail(email) {
  const key = normaliseEmail(email);
  return auth.users.find((u) => u.email === key) ?? null;
}

export function findUserById(id) {
  return auth.users.find((u) => u.id === id) ?? null;
}

/**
 * Create an account.
 *
 * @param {object} input name, email, password, role, plus role extras
 * @returns {{ok: boolean, user?: object, reason?: string}}
 */
export function registerUser(input = {}) {
  const name = String(input.name ?? "").trim();
  const email = normaliseEmail(input.email);
  const role = ROLES.includes(input.role) ? input.role : null;

  if (!name) return { ok: false, reason: "name_required" };
  if (!EMAIL_RE.test(email)) return { ok: false, reason: "email_invalid" };
  if (!role) return { ok: false, reason: "role_invalid" };

  const strength = checkPassword(input.password);
  if (!strength.ok) return strength;

  if (findUserByEmail(email)) return { ok: false, reason: "email_taken" };

  // Admin accounts are staff accounts: the invite code is the gate.
  if (role === "admin" && String(input.inviteCode ?? "").trim() !== ADMIN_CODE) {
    return { ok: false, reason: "invite_invalid" };
  }

  const id = `nrm-u-${auth.seq++}`;
  const user = {
    id,
    name: role === "doctor" && !/^dr\.?\s/i.test(name) ? `Dr. ${name}` : name,
    email,
    phone: String(input.phone ?? "").trim(),
    role,
    passwordHash: hashPassword(input.password),
    initials: initialsOf(name),
    avatar: AVATAR_BY_ROLE[role],
    district: input.district ?? "",
    division: input.division ?? "",
    createdAt: new Date().toISOString(),
    // Patients own their records under their own id from the first second.
    patientId: role === "patient" ? id : null,
    // A doctor is not bookable until an admin confirms the BM&DC number.
    doctorId: null,
    applicationId: null,
    verificationStatus: role === "doctor" ? VERIFICATION_STATUS.UNSUBMITTED : null,
  };

  auth.users.push(user);
  return { ok: true, user };
}

/** Link a doctor account to the application it just submitted. */
export function attachApplication(userId, applicationId) {
  const user = findUserById(userId);
  if (!user) return { ok: false, reason: "not_found" };
  user.applicationId = applicationId;
  user.verificationStatus = VERIFICATION_STATUS.PENDING;
  return { ok: true, user };
}

/** Called when an admin decides an application — publishes or rejects. */
export function syncDoctorAccount(applicationId, { status, doctorId = null }) {
  const user = auth.users.find((u) => u.applicationId === applicationId);
  if (!user) return { ok: false, reason: "not_found" };
  user.verificationStatus = status;
  if (doctorId) user.doctorId = doctorId;
  return { ok: true, user };
}

export function authenticate({ email, password, role }) {
  const user = findUserByEmail(email);
  // Same failure for "no such account" and "wrong password" — don't leak which.
  if (!user || !passwordMatches(String(password ?? ""), user.passwordHash)) {
    return { ok: false, reason: "bad_credentials" };
  }
  if (role && user.role !== role) return { ok: false, reason: "wrong_role", actualRole: user.role };
  return { ok: true, user };
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export function createSession(userId) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_DAYS * 86400000;
  auth.sessions.push({ token, userId, expiresAt });
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export function readSession(token) {
  if (!token) return null;
  const session = auth.sessions.find((s) => s.token === token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    destroySession(token);
    return null;
  }
  return findUserById(session.userId);
}

export function destroySession(token) {
  const i = auth.sessions.findIndex((s) => s.token === token);
  if (i >= 0) auth.sessions.splice(i, 1);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Demo accounts                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One ready-made account per role so the app can be reviewed without signing
 * up three times. The patient account owns the seeded appointments and
 * records, so it lands in a workspace that already has something in it.
 */
export const DEMO_PASSWORD = "niramoy123";

export const DEMO_ACCOUNTS = [
  { role: "patient", email: "nabila@example.com", name: CURRENT_PATIENT.name },
  { role: "doctor", email: "ayesha@example.com", name: "Dr. Ayesha Khan" },
  { role: "admin", email: "sakib@example.com", name: "Sakib Rahman" },
];

export function ensureDemoAccounts() {
  if (auth.users.length) return;

  for (const account of DEMO_ACCOUNTS) {
    const created = registerUser({
      ...account,
      password: DEMO_PASSWORD,
      inviteCode: account.role === "admin" ? ADMIN_CODE : undefined,
    });
    if (!created.ok) continue;

    if (account.role === "patient") {
      // Own the seeded history rather than starting empty.
      created.user.patientId = CURRENT_PATIENT.id;
      created.user.phone = CURRENT_PATIENT.phone;
      created.user.district = CURRENT_PATIENT.district;
      created.user.division = CURRENT_PATIENT.division;
    }
    if (account.role === "doctor") {
      created.user.verificationStatus = VERIFICATION_STATUS.VERIFIED;
      // doctorId is resolved lazily by the doctor workspace against the
      // directory; a real deployment sets it at approval time.
    }
  }
}
