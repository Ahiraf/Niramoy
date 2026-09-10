/**
 * /api/doctor/availability — a verified doctor's recurring hours.
 *
 * The doctor id is taken from the session's profile, never from the request.
 * Patients read the generated slots endpoint; this endpoint is only for the
 * doctor who owns the schedule.
 */
import { json, ok, withRoute } from "../../../../lib/api/respond";
import { AppError } from "../../../../lib/errors";
import * as directory from "../../../../lib/repositories/doctors";
import { requireDoctor } from "../../../../lib/security/authz";
import { getEnv } from "../../../../lib/config/env";
import { localToUtc } from "../../../../lib/scheduling/engine";

export const dynamic = "force-dynamic";

const TIME_RE = /^(\d{2}):(\d{2})$/;

function minutes(value: unknown, field: string): number {
  const match = TIME_RE.exec(String(value ?? ""));
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour > 23 || minute > 59) {
    throw new AppError("VALIDATION_FAILED", {
      details: { [field]: ["Use a valid 24-hour time, such as 09:00."] },
    });
  }
  return hour * 60 + minute;
}

function integer(value: unknown, field: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AppError("VALIDATION_FAILED", {
      details: { [field]: [`Enter a whole number between ${min} and ${max}.`] },
    });
  }
  return parsed;
}

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
    weekday: rule.weekday,
    localStart: `${String(Math.floor(rule.startMinute / 60)).padStart(2, "0")}:${String(rule.startMinute % 60).padStart(2, "0")}`,
    localEnd: `${String(Math.floor(rule.endMinute / 60)).padStart(2, "0")}:${String(rule.endMinute % 60).padStart(2, "0")}`,
    start: displayTime(rule.startMinute, zone),
    end: displayTime(rule.endMinute, zone),
    slotMinutes: rule.slotMinutes,
    bufferMinutes: rule.bufferMinutes,
    timezone: zone,
  };
}

async function ownDoctor(request: Request) {
  const principal = await requireDoctor(request);
  const profile = await directory.getProfileForUser(principal.userId);
  if (!profile || profile.verificationStatus !== "verified") {
    throw new AppError("NOT_VERIFIED");
  }
  return profile;
}

export const GET = withRoute("GET /api/doctor/availability", async (request) => {
  const profile = await ownDoctor(request);
  const rules = await directory.getAvailability(profile.id);
  return ok({ availability: rules.map(present) });
});

export const POST = withRoute("POST /api/doctor/availability", async (request) => {
  const profile = await ownDoctor(request);
  const body = await json<Record<string, unknown>>(request, 8192);
  const weekday = integer(body.weekday, "weekday", 0, 6);
  const startMinute = minutes(body.localStart, "localStart");
  const endMinute = minutes(body.localEnd, "localEnd");
  const slotMinutes = integer(body.slotMinutes ?? 20, "slotMinutes", 5, 120);
  const bufferMinutes = integer(body.bufferMinutes ?? 0, "bufferMinutes", 0, 60);

  if (endMinute <= startMinute) {
    throw new AppError("VALIDATION_FAILED", {
      details: { localEnd: ["The end time must be after the start time."] },
    });
  }
  if (slotMinutes > endMinute - startMinute) {
    throw new AppError("VALIDATION_FAILED", {
      details: { slotMinutes: ["The slot length must fit inside the consulting hours."] },
    });
  }

  const existing = await directory.getAvailability(profile.id);
  const overlaps = existing.some((rule) =>
    rule.weekday === weekday && startMinute < rule.endMinute && rule.startMinute < endMinute,
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
