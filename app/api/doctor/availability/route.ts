/**
 * /api/doctor/availability — a verified doctor's recurring weekly hours.
 *
 * The doctor id is taken from the session's profile, never from the request, so
 * there is no shape of request that edits somebody else's schedule. Patients
 * read the generated slots endpoint; this one is only for the owner.
 *
 * Date-specific availability — a one-off clinic, a blocked afternoon — lives at
 * ./exceptions. Kept separate because the two answer different questions: this
 * is "when do I normally work", that is "what is different about this date".
 */
import { json, ok, withRoute } from "../../../../lib/api/respond";
import { AppError } from "../../../../lib/errors";
import * as directory from "../../../../lib/repositories/doctors";
import { requireVerifiedDoctor } from "../../../../lib/security/authz";
import { getEnv } from "../../../../lib/config/env";
import { localToUtc } from "../../../../lib/scheduling/engine";
import {
  assertWindow,
  formatTimeMinutes,
  minutesOverlap,
  parseInteger,
  parseTimeMinutes,
} from "../../../../lib/scheduling/input";

export const dynamic = "force-dynamic";

function displayTime(minute: number, timeZone: string): string {
  // The app stores local hours with their zone, while this column is explicitly
  // labelled UTC. Use the same conversion as slot generation.
  const instant = localToUtc("2026-01-01", minute, timeZone);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}

function present(rule: directory.AvailabilityRule) {
  const zone = rule.timezone || getEnv().DISPLAY_TIMEZONE;
  return {
    id: rule.id,
    weekday: rule.weekday,
    localStart: formatTimeMinutes(rule.startMinute),
    localEnd: formatTimeMinutes(rule.endMinute),
    start: displayTime(rule.startMinute, zone),
    end: displayTime(rule.endMinute, zone),
    slotMinutes: rule.slotMinutes,
    bufferMinutes: rule.bufferMinutes,
    timezone: zone,
  };
}

export const GET = withRoute("GET /api/doctor/availability", async (request) => {
  const profile = await requireVerifiedDoctor(request);
  const rules = await directory.getAvailability(profile.id);
  return ok({ availability: rules.map(present), timezone: getEnv().DISPLAY_TIMEZONE });
});

export const POST = withRoute("POST /api/doctor/availability", async (request) => {
  const profile = await requireVerifiedDoctor(request);
  const body = await json<Record<string, unknown>>(request, 8192);

  const weekday = parseInteger(body.weekday, "weekday", 0, 6);
  const startMinute = parseTimeMinutes(body.localStart, "localStart");
  const endMinute = parseTimeMinutes(body.localEnd, "localEnd");
  const slotMinutes = parseInteger(body.slotMinutes ?? 20, "slotMinutes", 5, 120);
  const bufferMinutes = parseInteger(body.bufferMinutes ?? 0, "bufferMinutes", 0, 60);

  assertWindow(startMinute, endMinute, slotMinutes, { end: "localEnd", slot: "slotMinutes" });

  const existing = await directory.getAvailability(profile.id);
  const overlaps = existing.some(
    (rule) =>
      rule.weekday === weekday &&
      minutesOverlap(startMinute, endMinute, rule.startMinute, rule.endMinute),
  );
  if (overlaps) {
    throw new AppError("ALREADY_EXISTS", {
      message: "Those hours overlap an existing weekly schedule.",
    });
  }

  const rule = await directory.addAvailability(profile.id, {
    weekday,
    startMinute,
    endMinute,
    slotMinutes,
    bufferMinutes,
    timezone: getEnv().DISPLAY_TIMEZONE,
  });
  return ok({ availability: present(rule) }, { status: 201 });
});

/**
 * Remove one weekly rule.
 *
 * Appointments already booked inside it are deliberately untouched: the rule
 * describes when new bookings may be taken, and deleting it must not quietly
 * unbook a patient who is expecting to be seen. The doctor cancels those
 * individually, which is the path that actually notifies anyone.
 */
export const DELETE = withRoute("DELETE /api/doctor/availability", async (request) => {
  const profile = await requireVerifiedDoctor(request);
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) {
    throw new AppError("VALIDATION_FAILED", { details: { id: ["Which hours should be removed?"] } });
  }

  // Scoped to this doctor inside the delete itself. A miss is reported the same
  // way whether the rule belongs to someone else or does not exist.
  const removed = await directory.deleteAvailability(profile.id, id);
  if (!removed) throw new AppError("NOT_FOUND");

  return ok({ removed: true });
});
