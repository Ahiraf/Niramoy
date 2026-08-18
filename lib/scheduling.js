/**
 * Niramoy — Scheduling Engine
 * -----------------------------------------------------------------------------
 * The algorithmic core of the platform. Pure functions (no DB, no network) so
 * they are trivial to unit-test — this is the module your CSE-356 Testing
 * deliverable is built around.
 *
 * Model:
 *   - A doctor defines recurring availability RULES (weekday + time window +
 *     slot length + buffer).
 *   - Plus EXCEPTIONS (block a date, or add an extra window on a date).
 *   - The engine GENERATES concrete bookable slots from:
 *         rules  −  exceptions  −  already-booked  −  past/too-soon
 *
 * All times are handled in UTC. Store UTC everywhere; render local in the UI.
 */

/** Weekday numbers follow JS getUTCDay(): 0 = Sunday … 6 = Saturday. */

/**
 * @typedef {Object} AvailabilityRule
 * @property {number} weekday      0..6 (Sun..Sat)
 * @property {string} start        "HH:MM" 24h, UTC
 * @property {string} end          "HH:MM" 24h, UTC
 * @property {number} slotMinutes  length of one appointment slot
 * @property {number} [bufferMinutes=0] gap enforced after each slot
 */

/**
 * @typedef {Object} AvailabilityException
 * @property {string} date   "YYYY-MM-DD" (UTC calendar date)
 * @property {"block"|"extra"} type
 * @property {string} [start] required when type==="extra"
 * @property {string} [end]   required when type==="extra"
 * @property {number} [slotMinutes]
 * @property {number} [bufferMinutes]
 */

function pad(n) {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" for a Date, in UTC. */
function toDateKey(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate()
  )}`;
}

/** Parse "HH:MM" into minutes-from-midnight. Throws on malformed input. */
function parseHHMM(value) {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new Error(`Invalid time "${value}", expected "HH:MM"`);
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Out-of-range time "${value}"`);
  return hours * 60 + minutes;
}

/** Build a UTC Date from a "YYYY-MM-DD" key + minutes-from-midnight. */
function utcDateAt(dateKey, minutes) {
  const [y, mo, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 0, minutes, 0, 0));
}

/**
 * Expand a single (window on a specific date) into slot start Dates.
 * Slots advance by slotMinutes + bufferMinutes; a slot is only produced if it
 * fully fits inside [start, end].
 */
function expandWindow(dateKey, startMin, endMin, slotMinutes, bufferMinutes) {
  if (slotMinutes <= 0) throw new Error("slotMinutes must be > 0");
  const step = slotMinutes + Math.max(0, bufferMinutes || 0);
  const slots = [];
  for (let s = startMin; s + slotMinutes <= endMin; s += step) {
    slots.push(utcDateAt(dateKey, s));
  }
  return slots;
}

/**
 * Generate concrete bookable slots for one doctor over a date range.
 *
 * @param {Object} params
 * @param {AvailabilityRule[]}      params.rules
 * @param {AvailabilityException[]} [params.exceptions=[]]
 * @param {Date[]|string[]}         [params.booked=[]]  already-booked slot starts (UTC)
 * @param {Date}   params.rangeStart  inclusive
 * @param {Date}   params.rangeEnd    exclusive
 * @param {Date}   [params.now=new Date()]   slots at/before now (+ leadMinutes) are dropped
 * @param {number} [params.leadMinutes=0]    minimum minutes-from-now a slot must be
 * @returns {Date[]} sorted, de-duplicated, bookable slot start times (UTC)
 */
function generateSlots({
  rules,
  exceptions = [],
  booked = [],
  rangeStart,
  rangeEnd,
  now = new Date(),
  leadMinutes = 0,
}) {
  if (!(rangeStart instanceof Date) || !(rangeEnd instanceof Date)) {
    throw new Error("rangeStart and rangeEnd must be Date objects");
  }
  if (rangeStart >= rangeEnd) return [];

  const blocked = new Set(
    exceptions.filter((e) => e.type === "block").map((e) => e.date)
  );
  const extrasByDate = new Map();
  for (const e of exceptions) {
    if (e.type === "extra") {
      if (!extrasByDate.has(e.date)) extrasByDate.set(e.date, []);
      extrasByDate.get(e.date).push(e);
    }
  }

  const bookedSet = new Set(
    booked.map((b) => (b instanceof Date ? b : new Date(b)).getTime())
  );

  const cutoff = now.getTime() + leadMinutes * 60 * 1000;
  const out = [];
  const seen = new Set();

  // Walk each UTC calendar day in the range.
  const cursor = new Date(
    Date.UTC(
      rangeStart.getUTCFullYear(),
      rangeStart.getUTCMonth(),
      rangeStart.getUTCDate()
    )
  );
  while (cursor < rangeEnd) {
    const dateKey = toDateKey(cursor);
    const weekday = cursor.getUTCDay();

    const windows = [];
    if (!blocked.has(dateKey)) {
      for (const r of rules) {
        if (r.weekday === weekday) {
          windows.push({
            start: parseHHMM(r.start),
            end: parseHHMM(r.end),
            slotMinutes: r.slotMinutes,
            bufferMinutes: r.bufferMinutes || 0,
          });
        }
      }
    }
    // "extra" windows apply even on otherwise-blocked days.
    for (const ex of extrasByDate.get(dateKey) || []) {
      windows.push({
        start: parseHHMM(ex.start),
        end: parseHHMM(ex.end),
        slotMinutes: ex.slotMinutes || windows[0]?.slotMinutes || 20,
        bufferMinutes: ex.bufferMinutes || 0,
      });
    }

    for (const w of windows) {
      for (const slot of expandWindow(
        dateKey,
        w.start,
        w.end,
        w.slotMinutes,
        w.bufferMinutes
      )) {
        const t = slot.getTime();
        if (t < rangeStart.getTime() || t >= rangeEnd.getTime()) continue;
        if (t <= cutoff) continue; // past or inside the lead-time window
        if (bookedSet.has(t)) continue; // already taken
        if (seen.has(t)) continue; // de-dupe overlapping windows
        seen.add(t);
        out.push(slot);
      }
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}

/**
 * Decide whether a booking request is valid against the currently generated
 * slots. Returns a small result object (never throws for business-rule
 * failures) so callers/tests can assert on `.ok` and `.reason`.
 *
 * @returns {{ok: boolean, reason?: string}}
 */
function canBook({ requestedStart, availableSlots, now = new Date(), leadMinutes = 0 }) {
  const req =
    requestedStart instanceof Date ? requestedStart : new Date(requestedStart);
  if (Number.isNaN(req.getTime())) return { ok: false, reason: "invalid_time" };
  if (req.getTime() <= now.getTime()) return { ok: false, reason: "in_past" };
  if (req.getTime() <= now.getTime() + leadMinutes * 60 * 1000) {
    return { ok: false, reason: "too_soon" };
  }
  const found = availableSlots.some((s) => s.getTime() === req.getTime());
  if (!found) return { ok: false, reason: "slot_unavailable" };
  return { ok: true };
}

/**
 * Whether an appointment may still be cancelled, given a cancellation window.
 * @returns {boolean}
 */
function canCancel({ appointmentStart, now = new Date(), cancelWindowMinutes = 60 }) {
  const start =
    appointmentStart instanceof Date
      ? appointmentStart
      : new Date(appointmentStart);
  return start.getTime() - now.getTime() >= cancelWindowMinutes * 60 * 1000;
}

module.exports = {
  generateSlots,
  canBook,
  canCancel,
  // exported for unit testing of internals
  _internal: { parseHHMM, expandWindow, toDateKey, utcDateAt },
};
