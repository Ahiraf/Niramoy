/**
 * Shared helpers for the Niramoy API routes.
 * Keeps every handler to a single responsibility: parse → call store → respond.
 */

import { ensureDemoData } from "../../lib/store.js";

/** Every route calls this so a cold serverless instance has data to serve. */
export function boot() {
  ensureDemoData();
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
};

export function explain(reason) {
  return REASONS[reason] ?? "Something went wrong. Please try again.";
}

export function query(request) {
  return Object.fromEntries(new URL(request.url).searchParams);
}
