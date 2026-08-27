/**
 * Scheduling engine tests.
 *
 * Covers the requirements table from the Testing deliverable, plus the edge
 * cases the brief calls out: midnight boundaries, end-of-day slots, overlapping
 * rules and exceptions, buffers, cancellation right up against the window, and
 * timezone conversion.
 */
import {
  canBook, canCancel, describeSlot, generateSlots, localDateKey, localToUtc,
  localWeekday, overlaps, zoneOffsetMinutes, type AvailabilityRule, type Slot,
} from "../engine";

const TZ = "Asia/Dhaka"; // UTC+6, no DST
/** Sunday 2026-08-02, 09:00 Dhaka = 03:00 UTC. */
const NOW = new Date("2026-08-02T03:00:00Z");

const rule = (over: Partial<AvailabilityRule> = {}): AvailabilityRule => ({
  weekday: 0,
  startMinute: 10 * 60,
  endMinute: 12 * 60,
  slotMinutes: 20,
  bufferMinutes: 0,
  timezone: TZ,
  ...over,
});

const range = (days = 1, from: Date = NOW) => ({
  rangeStart: new Date(from),
  rangeEnd: new Date(from.getTime() + days * 86_400_000),
});

const starts = (slots: Slot[]): string[] => slots.map((s) => s.start.toISOString());

describe("timezone helpers", () => {
  it("reads the offset from the zone rather than assuming one", () => {
    expect(zoneOffsetMinutes(NOW, TZ)).toBe(360);
    expect(zoneOffsetMinutes(NOW, "UTC")).toBe(0);
  });

  it("converts a local wall time to the right instant", () => {
    // 10:00 Dhaka is 04:00 UTC.
    expect(localToUtc("2026-08-02", 10 * 60, TZ).toISOString()).toBe("2026-08-02T04:00:00.000Z");
  });

  it("handles a DST transition without landing an hour out", () => {
    // London springs forward at 01:00 UTC on 2026-03-29.
    const before = localToUtc("2026-03-29", 0 * 60, "Europe/London");
    const after = localToUtc("2026-03-29", 12 * 60, "Europe/London");
    expect(before.toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(after.toISOString()).toBe("2026-03-29T11:00:00.000Z");
  });

  it("reads the local date and weekday in the zone, not in UTC", () => {
    // 2026-08-02T20:00Z is already the 3rd in Dhaka.
    const late = new Date("2026-08-02T20:00:00Z");
    expect(localDateKey(late, TZ)).toBe("2026-08-03");
    expect(localWeekday(late, TZ)).toBe(1); // Monday
    expect(localDateKey(late, "UTC")).toBe("2026-08-02");
  });
});

describe("overlaps", () => {
  const at = (from: string, to: string) => ({ start: new Date(from), end: new Date(to) });

  it("treats adjacent intervals as not overlapping", () => {
    expect(
      overlaps(
        at("2026-08-02T10:00:00Z", "2026-08-02T10:30:00Z"),
        at("2026-08-02T10:30:00Z", "2026-08-02T11:00:00Z"),
      ),
    ).toBe(false);
  });

  it("detects a partial overlap", () => {
    expect(
      overlaps(
        at("2026-08-02T10:00:00Z", "2026-08-02T10:30:00Z"),
        at("2026-08-02T10:15:00Z", "2026-08-02T10:45:00Z"),
      ),
    ).toBe(true);
  });

  it("detects containment in both directions", () => {
    const outer = at("2026-08-02T10:00:00Z", "2026-08-02T11:00:00Z");
    const inner = at("2026-08-02T10:10:00Z", "2026-08-02T10:20:00Z");
    expect(overlaps(outer, inner)).toBe(true);
    expect(overlaps(inner, outer)).toBe(true);
  });
});

describe("generateSlots", () => {
  it("generates back-to-back slots inside the window", () => {
    const slots = generateSlots({ rules: [rule()], now: NOW, ...range(1) });
    // 10:00-12:00 Dhaka in 20-minute slots = 6, i.e. 04:00-06:00 UTC.
    expect(starts(slots)).toEqual([
      "2026-08-02T04:00:00.000Z",
      "2026-08-02T04:20:00.000Z",
      "2026-08-02T04:40:00.000Z",
      "2026-08-02T05:00:00.000Z",
      "2026-08-02T05:20:00.000Z",
      "2026-08-02T05:40:00.000Z",
    ]);
    expect(slots[0]!.end.toISOString()).toBe("2026-08-02T04:20:00.000Z");
    expect(slots[0]!.durationMinutes).toBe(20);
  });

  it("respects buffer time between slots", () => {
    const slots = generateSlots({
      rules: [rule({ endMinute: 11 * 60, bufferMinutes: 10 })],
      now: NOW,
      ...range(1),
    });
    // 20 + 10 buffer = 30-minute stride; 10:00 and 10:30 fit, 11:00 does not.
    expect(starts(slots)).toEqual(["2026-08-02T04:00:00.000Z", "2026-08-02T04:30:00.000Z"]);
  });

  it("only emits a slot that fits entirely inside the window", () => {
    const slots = generateSlots({
      rules: [rule({ startMinute: 10 * 60, endMinute: 10 * 60 + 50, slotMinutes: 20 })],
      now: NOW,
      ...range(1),
    });
    expect(slots).toHaveLength(2); // 10:00, 10:20; 10:40+20 would exceed 10:50
  });

  it("supports a window that runs to local midnight", () => {
    const slots = generateSlots({
      rules: [rule({ startMinute: 23 * 60, endMinute: 24 * 60, slotMinutes: 30 })],
      now: NOW,
      ...range(1),
    });
    expect(starts(slots)).toEqual([
      "2026-08-02T17:00:00.000Z", // 23:00 Dhaka
      "2026-08-02T17:30:00.000Z",
    ]);
  });

  it("drops slots at or before now + leadMinutes", () => {
    // 11:00 Dhaka = 05:00 UTC; a 2h lead from 09:00 local rules out 10:00-11:00.
    const slots = generateSlots({
      rules: [rule()],
      now: NOW,
      leadMinutes: 120,
      ...range(1),
    });
    expect(starts(slots)).toEqual([
      "2026-08-02T05:20:00.000Z",
      "2026-08-02T05:40:00.000Z",
    ]);
  });

  it("excludes a slot overlapping a booked interval, even partially", () => {
    const slots = generateSlots({
      rules: [rule()],
      now: NOW,
      booked: [
        {
          // 10:10-10:25 Dhaka overlaps both the 10:00 and the 10:20 slot.
          start: new Date("2026-08-02T04:10:00Z"),
          end: new Date("2026-08-02T04:25:00Z"),
        },
      ],
      ...range(1),
    });
    expect(starts(slots)).not.toContain("2026-08-02T04:00:00.000Z");
    expect(starts(slots)).not.toContain("2026-08-02T04:20:00.000Z");
    expect(starts(slots)).toContain("2026-08-02T04:40:00.000Z");
  });

  it("does not exclude a slot merely adjacent to a booked interval", () => {
    const slots = generateSlots({
      rules: [rule()],
      now: NOW,
      booked: [
        { start: new Date("2026-08-02T03:40:00Z"), end: new Date("2026-08-02T04:00:00Z") },
      ],
      ...range(1),
    });
    expect(starts(slots)).toContain("2026-08-02T04:00:00.000Z");
  });

  it("blocks a date via an exception, overriding the recurring rule", () => {
    const slots = generateSlots({
      rules: [rule()],
      exceptions: [{ date: "2026-08-02", type: "block", timezone: TZ }],
      now: NOW,
      ...range(1),
    });
    expect(slots).toHaveLength(0);
  });

  it("adds an extra window on a normally-off day", () => {
    const slots = generateSlots({
      rules: [rule({ weekday: 3 })], // Wednesday only
      exceptions: [
        {
          date: "2026-08-02",
          type: "extra",
          startMinute: 15 * 60,
          endMinute: 16 * 60,
          slotMinutes: 30,
          bufferMinutes: 0,
          timezone: TZ,
        },
      ],
      now: NOW,
      ...range(1),
    });
    expect(starts(slots)).toEqual([
      "2026-08-02T09:00:00.000Z", // 15:00 Dhaka
      "2026-08-02T09:30:00.000Z",
    ]);
  });

  it("lets an extra window run on an otherwise blocked day", () => {
    const slots = generateSlots({
      rules: [rule()],
      exceptions: [
        { date: "2026-08-02", type: "block", timezone: TZ },
        {
          date: "2026-08-02",
          type: "extra",
          startMinute: 15 * 60,
          endMinute: 16 * 60,
          slotMinutes: 60,
          timezone: TZ,
        },
      ],
      now: NOW,
      ...range(1),
    });
    expect(starts(slots)).toEqual(["2026-08-02T09:00:00.000Z"]);
  });

  it("de-duplicates two rules covering the same time", () => {
    const slots = generateSlots({
      rules: [rule(), rule({ startMinute: 11 * 60, endMinute: 13 * 60 })],
      now: NOW,
      ...range(1),
    });
    expect(new Set(starts(slots)).size).toBe(slots.length);
  });

  it("returns nothing for an inverted range", () => {
    expect(
      generateSlots({
        rules: [rule()],
        now: NOW,
        rangeStart: new Date(NOW.getTime() + 86_400_000),
        rangeEnd: NOW,
      }),
    ).toHaveLength(0);
  });

  it("returns nothing when the doctor has no availability", () => {
    expect(generateSlots({ rules: [], now: NOW, ...range(7) })).toHaveLength(0);
  });
});

describe("canBook", () => {
  const slots = () => generateSlots({ rules: [rule()], now: NOW, ...range(1) });

  it("accepts an available future slot", () => {
    expect(canBook({ requestedStart: slots()[0]!.start, availableSlots: slots(), now: NOW }).ok).toBe(true);
  });

  it("rejects a slot in the past", () => {
    expect(
      canBook({
        requestedStart: new Date(NOW.getTime() - 3_600_000),
        availableSlots: slots(),
        now: NOW,
      }),
    ).toMatchObject({ ok: false, reason: "in_past" });
  });

  it("rejects a slot inside the lead-time window", () => {
    expect(
      canBook({
        requestedStart: slots()[0]!.start,
        availableSlots: slots(),
        now: NOW,
        leadMinutes: 24 * 60,
      }),
    ).toMatchObject({ ok: false, reason: "too_soon" });
  });

  it("rejects a time that is not a generated slot", () => {
    expect(
      canBook({
        requestedStart: new Date("2026-08-02T04:07:00Z"),
        availableSlots: slots(),
        now: NOW,
      }),
    ).toMatchObject({ ok: false, reason: "slot_unavailable" });
  });

  it("rejects a slot overlapping an existing appointment", () => {
    expect(
      canBook({
        requestedStart: slots()[0]!.start,
        availableSlots: slots(),
        now: NOW,
        existing: [
          { start: new Date("2026-08-02T04:10:00Z"), end: new Date("2026-08-02T04:40:00Z") },
        ],
      }),
    ).toMatchObject({ ok: false, reason: "overlaps_existing" });
  });

  it("rejects invalid input", () => {
    expect(
      canBook({ requestedStart: "not a date", availableSlots: slots(), now: NOW }),
    ).toMatchObject({ ok: false, reason: "invalid_time" });
  });
});

describe("canCancel", () => {
  const start = new Date("2026-08-02T06:00:00Z");

  it("allows cancellation outside the window", () => {
    expect(canCancel({ appointmentStart: start, now: NOW, cancelWindowMinutes: 60 })).toBe(true);
  });

  it("blocks cancellation inside the window", () => {
    expect(
      canCancel({
        appointmentStart: start,
        now: new Date(start.getTime() - 30 * 60_000),
        cancelWindowMinutes: 60,
      }),
    ).toBe(false);
  });

  it("blocks cancellation exactly one second inside the window", () => {
    expect(
      canCancel({
        appointmentStart: start,
        now: new Date(start.getTime() - 60 * 60_000 + 1_000),
        cancelWindowMinutes: 60,
      }),
    ).toBe(false);
  });

  it("allows cancellation exactly on the window boundary", () => {
    expect(
      canCancel({
        appointmentStart: start,
        now: new Date(start.getTime() - 60 * 60_000),
        cancelWindowMinutes: 60,
      }),
    ).toBe(true);
  });
});

describe("describeSlot", () => {
  it("renders a UTC instant in Bangladesh local time", () => {
    const slot = {
      start: new Date("2026-08-02T04:00:00Z"),
      end: new Date("2026-08-02T04:20:00Z"),
      durationMinutes: 20,
    };
    expect(describeSlot(slot, TZ)).toMatchObject({
      dateKey: "2026-08-02",
      day: "Sun",
      date: "2",
      month: "Aug",
      localLabel: "10:00 AM",
      period: "Morning",
    });
  });

  it("puts an evening clinic in the evening, and on the right local day", () => {
    // 17:00 UTC is 23:00 Dhaka — same calendar day locally.
    const slot = {
      start: new Date("2026-08-02T17:00:00Z"),
      end: new Date("2026-08-02T17:30:00Z"),
      durationMinutes: 30,
    };
    expect(describeSlot(slot, TZ)).toMatchObject({
      dateKey: "2026-08-02",
      localLabel: "11:00 PM",
      period: "Evening",
    });
  });

  it("renders local noon and midnight without a 00/12 mix-up", () => {
    const noon = {
      start: new Date("2026-08-02T06:00:00Z"),
      end: new Date("2026-08-02T06:30:00Z"),
      durationMinutes: 30,
    };
    expect(describeSlot(noon, TZ).localLabel).toBe("12:00 PM");

    const midnight = {
      start: new Date("2026-08-01T18:00:00Z"),
      end: new Date("2026-08-01T18:30:00Z"),
      durationMinutes: 30,
    };
    expect(describeSlot(midnight, TZ).localLabel).toBe("12:00 AM");
  });
});
