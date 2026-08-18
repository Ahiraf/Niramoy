/**
 * Niramoy — Scheduling Engine unit tests
 * Run with:  npm test
 *
 * These cases map directly to the requirements-based test table in the
 * CSE-356 Testing deliverable (double-booking, past-date, boundary slots,
 * cancellation window, exceptions overriding recurring rules).
 */

const { describe, it, expect } = require("@jest/globals");
const { generateSlots, canBook, canCancel, _internal } = require("../scheduling");

// A fixed "now" so tests are deterministic. Sunday 2026-08-02, 09:00 UTC.
const NOW = new Date(Date.UTC(2026, 7, 2, 9, 0, 0));

// Doctor works Sundays (weekday 0) 10:00–12:00, 20-min slots, 0 buffer.
const sundayRule = [{ weekday: 0, start: "10:00", end: "12:00", slotMinutes: 20 }];

function range(days = 1, from = NOW) {
  const start = new Date(from);
  const end = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return { rangeStart: start, rangeEnd: end };
}

describe("generateSlots", () => {
  it("generates back-to-back slots inside the window", () => {
    const slots = generateSlots({ rules: sundayRule, now: NOW, ...range(1) });
    // 10:00,10:20,10:40,11:00,11:20,11:40 => 6 slots (11:40+20=12:00 fits)
    expect(slots.map((s) => s.toISOString())).toEqual([
      "2026-08-02T10:00:00.000Z",
      "2026-08-02T10:20:00.000Z",
      "2026-08-02T10:40:00.000Z",
      "2026-08-02T11:00:00.000Z",
      "2026-08-02T11:20:00.000Z",
      "2026-08-02T11:40:00.000Z",
    ]);
  });

  it("respects buffer time between slots", () => {
    const rule = [{ weekday: 0, start: "10:00", end: "11:00", slotMinutes: 20, bufferMinutes: 10 }];
    const slots = generateSlots({ rules: rule, now: NOW, ...range(1) });
    // step = 30min: 10:00, 10:30 (10:30+20=10:50 fits; 11:00+20 doesn't)
    expect(slots.map((s) => s.getUTCHours() + ":" + s.getUTCMinutes())).toEqual([
      "10:0",
      "10:30",
    ]);
  });

  it("drops slots at or before now + leadMinutes (too-soon rule)", () => {
    // now = 10:30 on the same Sunday, 60-min lead => first bookable is 11:40
    const now = new Date(Date.UTC(2026, 7, 2, 10, 30, 0));
    const slots = generateSlots({
      rules: sundayRule,
      now,
      leadMinutes: 60,
      ...range(1, now),
    });
    expect(slots[0].toISOString()).toBe("2026-08-02T11:40:00.000Z");
  });

  it("excludes already-booked slots (prevents double-booking)", () => {
    const booked = [new Date(Date.UTC(2026, 7, 2, 10, 20, 0))];
    const slots = generateSlots({ rules: sundayRule, booked, now: NOW, ...range(1) });
    expect(slots.find((s) => s.getUTCMinutes() === 20 && s.getUTCHours() === 10)).toBeUndefined();
    expect(slots).toHaveLength(5);
  });

  it("blocks a date via an exception, overriding the recurring rule", () => {
    const exceptions = [{ date: "2026-08-02", type: "block" }];
    const slots = generateSlots({ rules: sundayRule, exceptions, now: NOW, ...range(1) });
    expect(slots).toHaveLength(0);
  });

  it("adds an extra window on a normally-off day", () => {
    // Monday 2026-08-03 has no recurring rule, but an 'extra' window is added.
    const exceptions = [
      { date: "2026-08-03", type: "extra", start: "15:00", end: "16:00", slotMinutes: 30 },
    ];
    const from = new Date(Date.UTC(2026, 7, 3, 0, 0, 0));
    const slots = generateSlots({ rules: sundayRule, exceptions, now: NOW, ...range(1, from) });
    expect(slots.map((s) => s.toISOString())).toEqual([
      "2026-08-03T15:00:00.000Z",
      "2026-08-03T15:30:00.000Z",
    ]);
  });

  it("returns nothing for an inverted range", () => {
    const slots = generateSlots({
      rules: sundayRule,
      now: NOW,
      rangeStart: new Date(NOW.getTime() + 1000),
      rangeEnd: NOW,
    });
    expect(slots).toHaveLength(0);
  });
});

describe("canBook", () => {
  const slots = generateSlots({ rules: sundayRule, now: NOW, ...range(1) });

  it("accepts an available future slot", () => {
    expect(canBook({ requestedStart: slots[0], availableSlots: slots, now: NOW })).toEqual({ ok: true });
  });

  it("rejects a slot in the past", () => {
    const past = new Date(Date.UTC(2026, 7, 2, 8, 0, 0));
    expect(canBook({ requestedStart: past, availableSlots: slots, now: NOW }).reason).toBe("in_past");
  });

  it("rejects a slot that is not in the available set", () => {
    const odd = new Date(Date.UTC(2026, 7, 2, 10, 5, 0)); // 10:05 isn't a slot start
    expect(canBook({ requestedStart: odd, availableSlots: slots, now: NOW }).reason).toBe("slot_unavailable");
  });

  it("rejects invalid input", () => {
    expect(canBook({ requestedStart: "not-a-date", availableSlots: slots, now: NOW }).reason).toBe("invalid_time");
  });
});

describe("canCancel", () => {
  it("allows cancellation outside the window", () => {
    const start = new Date(NOW.getTime() + 3 * 60 * 60 * 1000); // 3h away
    expect(canCancel({ appointmentStart: start, now: NOW, cancelWindowMinutes: 60 })).toBe(true);
  });

  it("blocks cancellation inside the window", () => {
    const start = new Date(NOW.getTime() + 30 * 60 * 1000); // 30min away
    expect(canCancel({ appointmentStart: start, now: NOW, cancelWindowMinutes: 60 })).toBe(false);
  });
});

describe("internal helpers", () => {
  it("parseHHMM converts to minutes-from-midnight", () => {
    expect(_internal.parseHHMM("10:30")).toBe(630);
  });

  it("parseHHMM rejects malformed input", () => {
    expect(() => _internal.parseHHMM("25:00")).toThrow();
    expect(() => _internal.parseHHMM("bad")).toThrow();
  });
});
