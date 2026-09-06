"use client";

/**
 * Thin client for the Niramoy API routes.
 *
 * Components never call fetch directly, so cross-cutting concerns — CSRF,
 * error shape, query serialisation — live here and only here.
 */

const CSRF_COOKIE = "niramoy_csrf";
const CSRF_HEADER = "x-niramoy-csrf";

/**
 * The double-submit CSRF token.
 *
 * Read from a cookie the server deliberately leaves readable, and echoed in a
 * header. That is the whole mechanism: a page on another origin can cause the
 * cookie to be *sent*, but cannot *read* it to set the header. The token grants
 * nothing on its own — the session cookie is the credential, and it stays
 * HttpOnly so page script can never touch it.
 */
function csrfToken() {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === CSRF_COOKIE) {
      return decodeURIComponent(part.slice(index + 1));
    }
  }
  return null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function request(path, options = {}) {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = { "Content-Type": "application/json", ...(options.headers ?? {}) };

  if (!SAFE_METHODS.has(method)) {
    const token = csrfToken();
    if (token) headers[CSRF_HEADER] = token;
  }

  let res;
  try {
    res = await fetch(path, {
      ...options,
      method,
      headers,
      // The session cookie must ride along on every call.
      credentials: "same-origin",
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    // A network failure is not a server error; say so rather than showing a
    // generic "something went wrong".
    return { ok: false, reason: "network", message: "We couldn't reach Niramoy. Check your connection." };
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = { ok: false, reason: "bad_response" };
  }

  if (!res.ok) {
    // The backend sends both shapes during the migration: `error.code` is the
    // contract going forward, `reason` is what these components already read.
    if (!data.reason) data.reason = data.error?.code?.toLowerCase() ?? `http_${res.status}`;
    if (!data.message) data.message = data.error?.message ?? "Something went wrong. Please try again.";
    data.ok = false;
    data.status = res.status;
  }
  return data;
}

const qs = (params = {}) => {
  const clean = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  );
  return clean.length ? `?${new URLSearchParams(clean)}` : "";
};

export const api = {
  // Accounts. The session lives in an HttpOnly cookie, so there is no token to
  // pass around — the browser attaches it to every one of these calls.
  session: () => request("/api/auth"),
  login: (body) => request("/api/auth/login", { method: "POST", body }),
  register: (body) => request("/api/auth/register", { method: "POST", body }),
  logout: () => request("/api/auth", { method: "DELETE" }),
  updateProfile: (body) => request("/api/auth", { method: "PATCH", body }),
  changePassword: (body) => request("/api/auth/password", { method: "PATCH", body }),
  requestPasswordReset: (body) => request("/api/auth/password-reset", { method: "POST", body }),
  completePasswordReset: (body) => request("/api/auth/password-reset", { method: "PATCH", body }),
  verifyEmail: (body) => request("/api/auth/verify-email", { method: "POST", body }),
  /** The code at the front of sign-up, before any account exists. */
  sendSignupOtp: (body) => request("/api/auth/signup-otp", { method: "POST", body }),
  confirmSignupOtp: (body) => request("/api/auth/signup-otp", { method: "PATCH", body }),

  /** Sends an SMS code. Pass `{ phone }` to correct the number first. */
  sendPhoneCode: (body = {}) => request("/api/auth/verify-phone", { method: "POST", body }),
  confirmPhoneCode: (body) => request("/api/auth/verify-phone", { method: "PATCH", body }),

  reference: () => request("/api/reference"),

  doctors: (filters) => request(`/api/doctors${qs(filters)}`),
  doctor: (id) => request(`/api/doctors/${id}`),
  slots: (id, days = 14) => request(`/api/doctors/${id}/slots${qs({ days })}`),

  appointments: (filters) => request(`/api/appointments${qs(filters)}`),
  book: (body) => request("/api/appointments", { method: "POST", body }),
  updateAppointment: (id, body) =>
    request(`/api/appointments/${id}`, { method: "PATCH", body }),
  /** Mints a short-lived join token. POST because it issues a credential. */
  joinCall: (id) => request(`/api/appointments/${id}/video`, { method: "POST", body: {} }),

  records: () => request("/api/records"),
  addRecord: (body) => request("/api/records", { method: "POST", body }),

  prescriptions: () => request("/api/prescriptions"),
  addPrescription: (body) => request("/api/prescriptions", { method: "POST", body }),

  notifications: () => request("/api/notifications"),
  readNotifications: () => request("/api/notifications", { method: "POST", body: {} }),

  family: () => request("/api/family"),
  addFamily: (body) => request("/api/family", { method: "POST", body }),
  removeFamily: (id) => request(`/api/family${qs({ id })}`, { method: "DELETE" }),

  waitlist: () => request("/api/waitlist"),
  joinWaitlist: (body) => request("/api/waitlist", { method: "POST", body }),
  leaveWaitlist: (id) => request(`/api/waitlist${qs({ id })}`, { method: "DELETE" }),

  reviews: (doctorId) => request(`/api/reviews${qs({ doctorId })}`),
  addReview: (body) => request("/api/reviews", { method: "POST", body }),

  triage: (body) => request("/api/ai/triage", { method: "POST", body }),
  /** Drafts a summary. Always returns requiresReview — never a finished record. */
  summary: (body) => request("/api/ai/summary", { method: "POST", body }),
  reviewSummary: (id, body) => request(`/api/ai/summary/${id}`, { method: "PATCH", body }),

  /** Starts a payment. `method` is "bkash" or "cash". */
  pay: (body) => request("/api/payments", { method: "POST", body }),
  /** Confirms a bKash payment the payer authorised. Never sends a PIN. */
  executePayment: (id, body) =>
    request(`/api/payments/${id}/execute`, { method: "POST", body }),

  verificationQueue: () => request("/api/verification"),
  applyAsDoctor: (body) => request("/api/verification", { method: "POST", body }),
  decideApplication: (body) => request("/api/verification", { method: "PATCH", body }),

  adminOverview: () => request("/api/admin/overview"),
  adminDoctors: (filters) => request(`/api/admin/doctors${qs(filters)}`),
  adminDoctorAction: (body) => request("/api/admin/doctors", { method: "PATCH", body }),
  adminAudit: (filters) => request(`/api/admin/audit${qs(filters)}`),
};
