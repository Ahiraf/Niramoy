/**
 * Shared helpers for the Niramoy API routes.
 * Keeps every handler to a single responsibility: parse → call store → respond.
 */

import { ensureDemoData, CURRENT_PATIENT } from "../../lib/store.js";
import { SESSION_COOKIE, ensureDemoAccounts, readSession } from "../../lib/auth.js";

/** Every route calls this so a cold serverless instance has data to serve. */
export function boot() {
  ensureDemoData();
  ensureDemoAccounts();
}

/** Reads one cookie out of the raw request header. */
export function cookie(request, name) {
  const header = request?.headers?.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** Serialised session cookie. HttpOnly so page scripts can never read it. */
export function sessionCookie({ token, maxAge }) {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=${maxAge}`;
}

/** The signed-in user, or null. Routes decide whether null is acceptable. */
export function sessionUser(request) {
  return readSession(cookie(request, SESSION_COOKIE));
}

/**
 * Whose records a request is about. A signed-in patient sees their own; the
 * demo patient is the fallback so the app still works before sign-in.
 */
export function patientIdFor(request) {
  return sessionUser(request)?.patientId ?? CURRENT_PATIENT.id;
}

/**
 * Whose notifications a request is about. Doctors are addressed by their
 * published profile id, patients by their patient id.
 */
export function identityIdFor(request) {
  const user = sessionUser(request);
  if (!user) return CURRENT_PATIENT.id;
  return user.doctorId ?? user.patientId ?? user.id;
}

export function ok(data, init = {}) {
  return Response.json({ ok: true, ...data }, init);
}

export function fail(reason, status = 400) {
  return Response.json({ ok: false, reason }, { status });
}

/** Human-readable messages for the store's machine-readable failure reasons. */
export const REASONS = {
  in_past: "That time has already passed.",
  too_soon: "Appointments must be booked at least an hour in advance.",
  slot_unavailable: "That slot is no longer available.",
  slot_taken: "Someone just booked that slot. Please pick another.",
  doctor_not_found: "We couldn't find that doctor.",
  not_found: "We couldn't find that record.",
  cancel_window_closed: "Appointments can't be cancelled within an hour of the visit.",
  already_reviewed: "You've already reviewed this consultation.",
  invalid_time: "That doesn't look like a valid time.",

  // Accounts
  bad_credentials: "That email and password don't match an account.",
  wrong_role: "That account exists, but not for this role.",
  email_taken: "An account already uses that email.",
  email_invalid: "That doesn't look like a valid email address.",
  name_required: "Please tell us your name.",
  role_invalid: "Pick patient, doctor or admin.",
  password_too_short: "Use at least 8 characters.",
  password_too_simple: "Mix letters and numbers.",
  invite_invalid: "That staff invite code isn't valid.",
  unauthenticated: "Please sign in to continue.",
  forbidden: "Your account doesn't have access to that.",
};

export function explain(reason) {
  return REASONS[reason] ?? "Something went wrong. Please try again.";
}

export function query(request) {
  return Object.fromEntries(new URL(request.url).searchParams);
}
