/**
 * Date-specific availability.
 *
 * The weekly schedule was already covered; what was not, and what an
 * instructor demonstration actually needs, is a doctor opening one particular
 * date and a patient seeing those slots immediately.
 *
 * Two properties run through every test here:
 *
 *   1. The doctor id comes from the SESSION. There is no request shape that
 *      names someone else's schedule, so "a doctor cannot edit another
 *      doctor's hours" is not a comparison that could be forgotten.
 *   2. Times are entered as local wall-clock plus a zone, and stored as
 *      minutes-from-midnight. Instants are computed only when a slot is
 *      generated, and are always UTC.
 */
import {
  DELETE as availabilityDelete,
  GET as availabilityGet,
  POST as availabilityPost,
} from "../../app/api/doctor/availability/route";
import {
  DELETE as exceptionDelete,
  GET as exceptionsGet,
  POST as exceptionPost,
} from "../../app/api/doctor/availability/exceptions/route";
import { availableSlots } from "../../lib/services/booking";
import { localDateKey } from "../../lib/scheduling/engine";
import { requestAs, type World } from "../fixtures";
import { call, setupWorld, teardownWorld } from "../harness";

const BASE = "http://localhost:3000";
const ZONE = "Asia/Dhaka";

let world: World;

beforeEach(async () => {
  world = await setupWorld();
});

afterEach(async () => {
  await teardownWorld(world);
});

/** A date key `days` ahead, read in the doctor's own zone. */
function futureDateKey(days: number): string {
  return localDateKey(new Date(Date.now() + days * 86_400_000), ZONE);
}

async function addException(body: Record<string, unknown>, actor = world.doctor) {
  return call<{ exception: { id: string; date: string; type: string; allDay: boolean } }>(
    exceptionPost,
    requestAs(actor, `${BASE}/api/doctor/availability/exceptions`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

/** Every generated slot for the fixture doctor, over a wide horizon. */
async function slotsFor(dateKey: string) {
  const slots = await availableSlots(world.doctor.doctorId!, { days: 45 });
  return slots.filter((slot) => localDateKey(slot.start, ZONE) === dateKey);
}

/** Drop the fixture doctor's recurring hours, leaving only what a test adds. */
async function clearWeeklyHours(): Promise<void> {
  await world.h.client.exec(
    `DELETE FROM doctor_availability WHERE doctor_id = '${world.doctor.doctorId}'`,
  );
}

describe("one-time availability", () => {
  it("creates bookable slots on a single future date, with no weekly rule at all", async () => {
    await clearWeeklyHours();
    const date = futureDateKey(10);

    const res = await addException({
      type: "extra",
      date,
      localStart: "18:00",
      localEnd: "20:00",
      slotMinutes: "30",
    });
    expect(res.status).toBe(201);

    const slots = await slotsFor(date);
    // 18:00, 18:30, 19:00, 19:30 — four half-hours inside a two-hour window.
    expect(slots).toHaveLength(4);

    /*
     * 18:00 in Dhaka is 12:00 UTC. Asserted as an instant rather than a
     * formatted string: this is the conversion the whole scheduling layer
     * rests on, and the prototype got it wrong by hardcoding the offset.
     */
    expect(slots[0]!.start.toISOString()).toBe(`${date}T12:00:00.000Z`);
    expect(slots[0]!.durationMinutes).toBe(30);
  });

  it("is reported as a published schedule, so the patient is not told there is none", async () => {
    await clearWeeklyHours();
    const date = futureDateKey(10);
    await addException({ type: "extra", date, localStart: "18:00", localEnd: "20:00" });

    const slots = await availableSlots(world.doctor.doctorId!, { days: 45 });
    expect((slots as { hasPublishedHours?: boolean }).hasPublishedHours).toBe(true);
  });

  it("applies on top of a day the doctor has otherwise blocked", async () => {
    const date = futureDateKey(11);
    await addException({ type: "block", date });
    await addException({ type: "extra", date, localStart: "18:00", localEnd: "19:00" });

    const slots = await slotsFor(date);
    // The weekly 10:00–18:00 clinic is gone; the one-off evening hour remains.
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((slot) => slot.start.toISOString() >= `${date}T12:00:00.000Z`)).toBe(true);
  });
});

describe("blocking", () => {
  it("removes the whole day when no hours are given", async () => {
    const date = futureDateKey(12);
    expect((await slotsFor(date)).length).toBeGreaterThan(0);

    const res = await addException({ type: "block", date });
    expect(res.status).toBe(201);
    expect(res.body.exception.allDay).toBe(true);

    expect(await slotsFor(date)).toHaveLength(0);
  });

  it("removes only the hours given, leaving the rest of the day bookable", async () => {
    const date = futureDateKey(13);
    const before = await slotsFor(date);

    // 14:00–15:00 Dhaka is 08:00–09:00 UTC.
    await addException({ type: "block", date, localStart: "14:00", localEnd: "15:00" });

    const after = await slotsFor(date);
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThan(before.length);
    expect(
      after.some(
        (slot) =>
          slot.start.toISOString() >= `${date}T08:00:00.000Z` &&
          slot.start.toISOString() < `${date}T09:00:00.000Z`,
      ),
    ).toBe(false);
  });
});

describe("what is refused", () => {
  it("will not take a date in the past", async () => {
    const res = await addException({
      type: "extra",
      date: localDateKey(new Date(Date.now() - 2 * 86_400_000), ZONE),
      localStart: "18:00",
      localEnd: "20:00",
    });
    expect(res.status).toBe(400);
  });

  it("will not take an end time at or before the start", async () => {
    const res = await addException({
      type: "extra",
      date: futureDateKey(5),
      localStart: "20:00",
      localEnd: "18:00",
    });
    expect(res.status).toBe(400);
  });

  it("will not take a slot length that cannot fit inside the hours", async () => {
    const res = await addException({
      type: "extra",
      date: futureDateKey(5),
      localStart: "18:00",
      localEnd: "18:30",
      slotMinutes: "60",
    });
    expect(res.status).toBe(400);
  });

  it("will not take extra hours overlapping extra hours already on that date", async () => {
    const date = futureDateKey(6);
    expect((await addException({ type: "extra", date, localStart: "18:00", localEnd: "20:00" })).status).toBe(201);

    const clash = await addException({ type: "extra", date, localStart: "19:00", localEnd: "21:00" });
    expect(clash.status).toBe(409);
  });

  it("lets blocks overlap each other, because subtracting twice subtracts once", async () => {
    const date = futureDateKey(7);
    expect((await addException({ type: "block", date, localStart: "14:00", localEnd: "16:00" })).status).toBe(201);
    expect((await addException({ type: "block", date, localStart: "15:00", localEnd: "17:00" })).status).toBe(201);
  });

  it("will not take overlapping weekly hours", async () => {
    const first = await call(
      availabilityPost,
      requestAs(world.doctor, `${BASE}/api/doctor/availability`, {
        method: "POST",
        body: JSON.stringify({ weekday: 2, localStart: "19:00", localEnd: "21:00" }),
      }),
    );
    // The fixture doctor already works 10:00–18:00 every day, so 19:00 is free.
    expect(first.status).toBe(201);

    const clash = await call(
      availabilityPost,
      requestAs(world.doctor, `${BASE}/api/doctor/availability`, {
        method: "POST",
        body: JSON.stringify({ weekday: 2, localStart: "20:00", localEnd: "22:00" }),
      }),
    );
    expect(clash.status).toBe(409);
  });
});

describe("one doctor's schedule is not another's", () => {
  it("will not delete a weekly rule belonging to someone else", async () => {
    const mine = await call<{ availability: { id: string } }>(
      availabilityGet,
      requestAs(world.doctor, `${BASE}/api/doctor/availability`),
    );
    const ruleId = (mine.body as unknown as { availability: Array<{ id: string }> }).availability[0]!.id;

    const res = await call(
      availabilityDelete,
      requestAs(world.otherDoctor, `${BASE}/api/doctor/availability?id=${ruleId}`, {
        method: "DELETE",
      }),
    );
    // 404, not 403: whether that rule exists is not theirs to learn.
    expect(res.status).toBe(404);

    // And it is still there.
    const after = await call(
      availabilityGet,
      requestAs(world.doctor, `${BASE}/api/doctor/availability`),
    );
    const rules = (after.body as unknown as { availability: unknown[] }).availability;
    expect(rules.length).toBe(7);
  });

  it("will not delete a dated entry belonging to someone else", async () => {
    const created = await addException({ type: "block", date: futureDateKey(8) });
    const id = created.body.exception.id;

    const res = await call(
      exceptionDelete,
      requestAs(world.otherDoctor, `${BASE}/api/doctor/availability/exceptions?id=${id}`, {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("shows a doctor only their own dated entries", async () => {
    await addException({ type: "block", date: futureDateKey(9) });

    const theirs = await call(
      exceptionsGet,
      requestAs(world.otherDoctor, `${BASE}/api/doctor/availability/exceptions`),
    );
    expect((theirs.body as unknown as { exceptions: unknown[] }).exceptions).toHaveLength(0);
  });
});

describe("removing availability", () => {
  it("stops generating slots once a weekly rule is deleted", async () => {
    const listed = await call(
      availabilityGet,
      requestAs(world.doctor, `${BASE}/api/doctor/availability`),
    );
    const rules = (listed.body as unknown as { availability: Array<{ id: string; weekday: number }> })
      .availability;

    for (const rule of rules) {
      const res = await call(
        availabilityDelete,
        requestAs(world.doctor, `${BASE}/api/doctor/availability?id=${rule.id}`, {
          method: "DELETE",
        }),
      );
      expect(res.status).toBe(200);
    }

    expect(await slotsFor(futureDateKey(14))).toHaveLength(0);
  });

  it("brings a blocked day back when the block is removed", async () => {
    const date = futureDateKey(15);
    const created = await addException({ type: "block", date });
    expect(await slotsFor(date)).toHaveLength(0);

    const res = await call(
      exceptionDelete,
      requestAs(world.doctor, `${BASE}/api/doctor/availability/exceptions?id=${created.body.exception.id}`, {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(200);
    expect((await slotsFor(date)).length).toBeGreaterThan(0);
  });
});
