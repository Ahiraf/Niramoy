"use client";

/**
 * Thin client for the Niramoy API routes.
 * Components never call fetch directly — so when the backend moves to Postgres
 * or gains auth headers, this is the only client-side file that changes.
 */

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = { ok: false, reason: "bad_response" };
  }
  if (!res.ok && !data.reason) data.reason = `http_${res.status}`;
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

  reference: () => request("/api/reference"),

  doctors: (filters) => request(`/api/doctors${qs(filters)}`),
  doctor: (id) => request(`/api/doctors/${id}`),
  slots: (id, days = 14) => request(`/api/doctors/${id}/slots${qs({ days })}`),

  appointments: (filters) => request(`/api/appointments${qs(filters)}`),
  book: (body) => request("/api/appointments", { method: "POST", body }),
  updateAppointment: (id, body) =>
    request(`/api/appointments/${id}`, { method: "PATCH", body }),

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
  summary: (body) => request("/api/ai/summary", { method: "POST", body }),

  verificationQueue: () => request("/api/verification"),
  applyAsDoctor: (body) => request("/api/verification", { method: "POST", body }),
  decideApplication: (body) => request("/api/verification", { method: "PATCH", body }),
};
