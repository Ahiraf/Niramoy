/**
 * Niramoy — scheduling engine
 * -----------------------------------------------------------------------------
 * Pure. No database, no network, no clock of its own — `now` is always passed
 * in. That is what makes it exhaustively testable, and it is the module the
 * Testing deliverable is built around.
 *
 * Model:
 *   available windows  −  exceptions  −  booked intervals  −  past/too-soon
 *   = bookable slots
 *
 * Two changes from the prototype's engine, both of which were correctness bugs
 * rather than missing features:
 *
 *   1. A slot is an INTERVAL, not an instant. The prototype produced start times
 *      and compared a booking request to them by exact equality, so a request
 *      overlapping an existing appointment by 15 minutes was indistinguishable
 *      from one at a completely free time. Overlap is now computed properly.
 *
 *   2. Availability is expressed in the doctor's LOCAL time with an IANA zone,
 *      and converted here. The prototype stored windows as UTC minutes computed
 *      by subtracting a hardcoded six hours, which bakes in an offset and
 *      produces a negative hour for any clinic starting before 06:00 local.
 */

export interface AvailabilityRule {
  /** 0 = Sunday … 6 = Saturday, in the rule's own timezone. */
  weekday: number;
  /** Minutes from local midnight. `endMinute` may be 1440. */
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  bufferMinutes: number;
  /** IANA zone, e.g. "Asia/Dhaka". */
  timezone: string;
}

export interface AvailabilityException {
  /** Local calendar date, "YYYY-MM-DD". */
  date: string;
  type: "block" | "extra";
  startMinute?: number | null;
  endMinute?: number | null;
  slotMinutes?: number | null;
  bufferMinutes?: number | null;
  timezone: string;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface Slot {
  start: Date;
  end: Date;
  durationMinutes: number;
}

export interface GenerateSlotsParams {
  rules: AvailabilityRule[];
  exceptions?: AvailabilityException[];
  /** Intervals already taken. Any slot overlapping one is dropped. */
  booked?: Interval[];
  rangeStart: Date;
  rangeEnd: Date;
  now?: Date;
  /** Minimum notice, in minutes, before a slot may be booked. */
  leadMinutes?: number;
}

/* -------------------------------------------------------------------------- */
/* Timezone helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The UTC offset of a zone at a given instant, in minutes.
 *
 * Uses Intl rather than a fixed constant, so the engine is correct for any zone
 * and would remain correct if Bangladesh ever adopted daylight saving — which it
 * has trialled before. Nothing here assumes UTC+6.
 */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = formatter.formatToParts(instant);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  // What the wall clock reads in that zone, interpreted as if it were UTC.
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** "YYYY-MM-DD" for an instant, as read in the given zone. */
export function localDateKey(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Weekday (0 = Sunday) for an instant, as read in the given zone. */
export function localWeekday(instant: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(instant);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/**
 * The instant at which a local date and minute-of-day occurs in a zone.
 *
 * Two passes: guess with the offset at the naive instant, then correct using the
 * offset that actually applies at the guessed instant. That second pass is what
 * makes a DST boundary come out right; without it, a window on a transition day
 * lands an hour out.
 */
export function localToUtc(dateKey: string, minuteOfDay: number, timeZone: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const naive = Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 0, minuteOfDay, 0, 0);

  const firstGuess = new Date(naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60_000);
  const correction = zoneOffsetMinutes(firstGuess, timeZone);
  return new Date(naive - correction * 60_000);
}

/* -------------------------------------------------------------------------- */
/* Interval arithmetic                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Do two half-open intervals overlap?
 *
 * Half-open [start, end) is deliberate: an appointment ending at 10:30 and one
 * starting at 10:30 are adjacent, not overlapping. This is the same semantics
 * as the database's `tstzrange(..., '[)')` exclusion constraint, so the engine
 * and the constraint can never disagree about a boundary case.
 */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/* -------------------------------------------------------------------------- */
/* Slot generation                                                             */
/* -------------------------------------------------------------------------- */

interface Window {
  dateKey: string;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  bufferMinutes: number;
  timezone: string;
}

function expandWindow(window: Window): Slot[] {
  if (window.slotMinutes <= 0) throw new Error("slotMinutes must be greater than 0");

  const step = window.slotMinutes + Math.max(0, window.bufferMinutes);
  const slots: Slot[] = [];

  // A slot is produced only if it fits entirely inside the window.
  for (
    let minute = window.startMinute;
    minute + window.slotMinutes <= window.endMinute;
    minute += step
  ) {
    const start = localToUtc(window.dateKey, minute, window.timezone);
    slots.push({
      start,
      end: new Date(start.getTime() + window.slotMinutes * 60_000),
      durationMinutes: window.slotMinutes,
    });
  }
  return slots;
}

export function generateSlots({
  rules,
  exceptions = [],
  booked = [],
  rangeStart,
  rangeEnd,
  now = new Date(),
  leadMinutes = 0,
}: GenerateSlotsParams): Slot[] {
  if (!(rangeStart instanceof Date) || !(rangeEnd instanceof Date)) {
    throw new Error("rangeStart and rangeEnd must be Date objects");
  }
  if (rangeStart >= rangeEnd) return [];
  if (!rules.length && !exceptions.length) return [];

  const zone = rules[0]?.timezone ?? exceptions[0]?.timezone ?? "UTC";

  const blocked = new Set(exceptions.filter((e) => e.type === "block").map((e) => e.date));
  const extrasByDate = new Map<string, AvailabilityException[]>();
  for (const exception of exceptions) {
    if (exception.type !== "extra") continue;
    const list = extrasByDate.get(exception.date) ?? [];
    list.push(exception);
    extrasByDate.set(exception.date, list);
  }

  const cutoff = now.getTime() + leadMinutes * 60_000;
  const windows: Window[] = [];

  // Walk local calendar days. One day either side of the range absorbs the case
  // where a UTC range boundary falls mid-day in the local zone.
  const dayMs = 86_400_000;
  for (
    let cursor = rangeStart.getTime() - dayMs;
    cursor <= rangeEnd.getTime() + dayMs;
    cursor += dayMs
  ) {
    const instant = new Date(cursor);
    const dateKey = localDateKey(instant, zone);
    const weekday = localWeekday(instant, zone);

    if (windows.some((w) => w.dateKey === dateKey)) continue;

    if (!blocked.has(dateKey)) {
      for (const rule of rules) {
        if (rule.weekday !== weekday) continue;
        windows.push({
          dateKey,
          startMinute: rule.startMinute,
          endMinute: rule.endMinute,
          slotMinutes: rule.slotMinutes,
          bufferMinutes: rule.bufferMinutes,
          timezone: rule.timezone,
        });
      }
    }

    // An "extra" window applies even on an otherwise blocked day — that is how
    // a doctor adds a one-off clinic during their leave.
    for (const extra of extrasByDate.get(dateKey) ?? []) {
      windows.push({
        dateKey,
        startMinute: extra.startMinute ?? 0,
        endMinute: extra.endMinute ?? 0,
        slotMinutes: extra.slotMinutes ?? rules[0]?.slotMinutes ?? 20,
        bufferMinutes: extra.bufferMinutes ?? 0,
        timezone: extra.timezone,
      });
    }
  }

  const seen = new Set<number>();
  const out: Slot[] = [];

  for (const window of windows) {
    for (const slot of expandWindow(window)) {
      const time = slot.start.getTime();

      if (time < rangeStart.getTime() || time >= rangeEnd.getTime()) continue;
      if (time <= cutoff) continue; // past, or inside the lead-time window
      if (seen.has(time)) continue; // two rules covering the same time
      if (booked.some((interval) => overlaps(slot, interval))) continue;

      seen.add(time);
      out.push(slot);
    }
  }

  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

/* -------------------------------------------------------------------------- */
/* Booking rules                                                               */
/* -------------------------------------------------------------------------- */

export type BookFailure =
  | "invalid_time"
  | "in_past"
  | "too_soon"
  | "slot_unavailable"
  | "overlaps_existing";

export interface BookCheck {
  ok: boolean;
  reason?: BookFailure;
  slot?: Slot;
}

/**
 * Validate a booking request against generated slots.
 *
 * Returns a result rather than throwing for a business-rule failure, so the
 * caller and the tests can assert on `.reason`.
 *
 * This is advisory. The database's exclusion constraint is the authority — by
 * the time this returns, another request may already have taken the slot. The
 * check exists to give a useful message in the common case, not to prevent the
 * race (brief §5: never rely on frontend or pre-flight availability).
 */
export function canBook({
  requestedStart,
  availableSlots,
  now = new Date(),
  leadMinutes = 0,
  existing = [],
}: {
  requestedStart: Date | string;
  availableSlots: Slot[];
  now?: Date;
  leadMinutes?: number;
  existing?: Interval[];
}): BookCheck {
  const start = requestedStart instanceof Date ? requestedStart : new Date(requestedStart);
  if (Number.isNaN(start.getTime())) return { ok: false, reason: "invalid_time" };

  if (start.getTime() <= now.getTime()) return { ok: false, reason: "in_past" };
  if (start.getTime() <= now.getTime() + leadMinutes * 60_000) {
    return { ok: false, reason: "too_soon" };
  }

  const slot = availableSlots.find((s) => s.start.getTime() === start.getTime());
  if (!slot) return { ok: false, reason: "slot_unavailable" };

  if (existing.some((interval) => overlaps(slot, interval))) {
    return { ok: false, reason: "overlaps_existing" };
  }

  return { ok: true, slot };
}

/** Whether an appointment may still be cancelled. */
export function canCancel({
  appointmentStart,
  now = new Date(),
  cancelWindowMinutes = 60,
}: {
  appointmentStart: Date | string;
  now?: Date;
  cancelWindowMinutes?: number;
}): boolean {
  const start =
    appointmentStart instanceof Date ? appointmentStart : new Date(appointmentStart);
  return start.getTime() - now.getTime() >= cancelWindowMinutes * 60_000;
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                                */
/* -------------------------------------------------------------------------- */

export interface DescribedSlot {
  startUtc: string;
  endUtc: string;
  durationMinutes: number;
  dateKey: string;
  day: string;
  date: string;
  month: string;
  localLabel: string;
  period: "Morning" | "Afternoon" | "Evening";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Render a slot in the display timezone, in the shape the existing UI reads. */
/**
 * A short, unambiguous name for the zone a time is being shown in.
 *
 * Every time in this application is stored in UTC and rendered in one display
 * zone, which is correct — and invisible. A patient in Dhaka and a relative
 * booking for them from Jeddah see the same string and have no way to tell
 * which clock it refers to. Naming the zone next to the time is the whole fix.
 *
 * Computed from the zone and the instant, never hardcoded: Bangladesh has run
 * daylight saving before (2009), and a frozen "+6" would have been wrong then.
 */
export function timezoneLabel(timeZone: string, at: Date = new Date()): string {
  const offset =
    new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? "";

  // "Asia/Dhaka" -> "Dhaka". The city is what a patient recognises; the offset
  // is what someone abroad needs.
  const city = timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
  return offset ? `${city} time (${offset})` : `${city} time`;
}

export function describeSlot(slot: Slot, timeZone: string): DescribedSlot {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(slot.start);

  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = get("hour") % 24;
  const minute = get("minute");
  const h12 = hour % 12 === 0 ? 12 : hour % 12;

  return {
    startUtc: slot.start.toISOString(),
    endUtc: slot.end.toISOString(),
    durationMinutes: slot.durationMinutes,
    dateKey: localDateKey(slot.start, timeZone),
    day: DAYS[localWeekday(slot.start, timeZone)] ?? "",
    date: String(get("day")),
    month: MONTHS[get("month") - 1] ?? "",
    localLabel: `${String(h12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`,
    period: hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening",
  };
}
