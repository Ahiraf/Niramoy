/**
 * Niramoy — parsing and checking schedule input
 * -----------------------------------------------------------------------------
 * Shared by the recurring-hours endpoint and the date-specific one, because the
 * two ask almost the same questions and answering them differently is how a
 * doctor ends up able to create a one-off clinic they could never have created
 * as a weekly rule.
 *
 * Everything here works in LOCAL wall-clock terms — a date key and minutes from
 * local midnight — and never in instants. Conversion to UTC happens in one
 * place, `localToUtc`, and only when a slot is generated. Nothing in this file
 * subtracts six hours from anything.
 */

import { AppError } from "../errors";
import { localDateKey } from "./engine";

const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "09:00" -> 540. Rejects anything that is not a real 24-hour time. */
export function parseTimeMinutes(value: unknown, field: string): number {
  const match = TIME_RE.exec(String(value ?? "").trim());
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour > 23 || minute > 59) {
    throw new AppError("VALIDATION_FAILED", {
      details: { [field]: ["Use a valid 24-hour time, such as 09:00."] },
    });
  }
  return hour * 60 + minute;
}

/** 540 -> "09:00". The inverse, for handing a stored rule back to the UI. */
export function formatTimeMinutes(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function parseInteger(value: unknown, field: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AppError("VALIDATION_FAILED", {
      details: { [field]: [`Enter a whole number between ${min} and ${max}.`] },
    });
  }
  return parsed;
}

/**
 * A "YYYY-MM-DD" that is today or later IN THE DOCTOR'S OWN ZONE.
 *
 * Comparing date keys as strings is exact here and comparing instants would not
 * be: "is 2026-09-15 in the past" has no answer until you say whose midnight
 * you mean, and a doctor in Dhaka adding an evening clinic for today would be
 * told they were living in the past by a server reading UTC.
 */
export function parseFutureDateKey(
  value: unknown,
  field: string,
  timeZone: string,
  now: Date = new Date(),
): string {
  const raw = String(value ?? "").trim();
  const match = DATE_RE.exec(raw);
  if (!match) {
    throw new AppError("VALIDATION_FAILED", {
      details: { [field]: ["Use a date in the form 2026-09-20."] },
    });
  }

  // Catches 2026-02-31, which the regex is happy with.
  const asUtc = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(asUtc.getTime()) || asUtc.toISOString().slice(0, 10) !== raw) {
    throw new AppError("VALIDATION_FAILED", {
      details: { [field]: ["That date does not exist."] },
    });
  }

  if (raw < localDateKey(now, timeZone)) {
    throw new AppError("VALIDATION_FAILED", {
      details: { [field]: ["Pick today or a future date."] },
    });
  }
  return raw;
}

/**
 * A start/end pair that a slot length can actually be laid out inside.
 *
 * `endMinute` may be 1440 — a clinic running to midnight is a real thing and
 * the `time` type cannot express it, which is why these are stored as minutes.
 */
export function assertWindow(
  startMinute: number,
  endMinute: number,
  slotMinutes: number,
  fields: { end: string; slot: string },
): void {
  if (endMinute <= startMinute) {
    throw new AppError("VALIDATION_FAILED", {
      details: { [fields.end]: ["The end time must be after the start time."] },
    });
  }
  if (slotMinutes > endMinute - startMinute) {
    throw new AppError("VALIDATION_FAILED", {
      details: { [fields.slot]: ["The slot length must fit inside these hours."] },
    });
  }
}

/** Half-open overlap on minute ranges, matching the engine's interval rule. */
export function minutesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
