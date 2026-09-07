/**
 * Scheduled job tests.
 *
 * The property under test is idempotency: running a job twice must not send a
 * second message or mutate state twice. A scheduler will eventually do it —
 * a retry after a timeout, an overlapping invocation, a manual trigger during
 * an incident — so "it only runs once" is not something a cron expression can
 * promise.
 */
import { seedAppointment, type World } from "../fixtures";
import { resetEnvCache } from "../../lib/config/env";
import { setupWorld, teardownWorld } from "../harness";
import {
  NO_SHOW_GRACE_MINUTES, REMINDER_LEAD_HOURS, sendReminders, sweepExpired, sweepNoShows,
} from "../../lib/services/jobs";

let world: World;

beforeEach(async () => {
  world = await setupWorld();
});

afterEach(async () => {
  await teardownWorld(world);
});

/**
 * The reminder window has to match how often the job is scheduled.
 *
 * A run covers appointments starting REMINDER_LEAD_HOURS from now, for one
 * window. Scheduling the job daily while the window stays at the hourly
 * default is the kind of misconfiguration that reports success: the run
 * completes, says it processed some appointments, and the rest of the day's
 * patients are never told. Vercel's Hobby plan forces exactly that schedule,
 * so this is a live configuration, not a hypothetical one.
 */
describe("the reminder window follows the schedule", () => {
  /** Twenty hours past the lead time — inside a daily window, outside an hourly one. */
  const wellIntoTomorrow = (now: Date) =>
    new Date(now.getTime() + REMINDER_LEAD_HOURS * 3_600_000 + 20 * 3_600_000);

  afterEach(() => {
    delete process.env.REMINDER_WINDOW_MINUTES;
    resetEnvCache();
  });

  it("misses the rest of the day when left hourly", async () => {
    const now = new Date();
    await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: wellIntoTomorrow(now).toISOString(),
      status: "confirmed",
    });

    // The default. Correct for an hourly cron, and the trap for a daily one.
    const result = await sendReminders(now);

    expect(result.processed).toBe(0);
  });

  it("covers a full day when told the run is daily", async () => {
    const now = new Date();
    await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: wellIntoTomorrow(now).toISOString(),
      status: "confirmed",
    });

    process.env.REMINDER_WINDOW_MINUTES = "1440";
    resetEnvCache();

    const result = await sendReminders(now);

    expect(result.processed).toBe(1);
  });

  it("does not tell a patient two days out that it is tomorrow", async () => {
    const now = new Date();
    await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: wellIntoTomorrow(now).toISOString(),
      status: "confirmed",
    });

    process.env.REMINDER_WINDOW_MINUTES = "1440";
    resetEnvCache();
    await sendReminders(now);

    const { rows } = await world.h.client.query<{ title: string }>(
      `SELECT title FROM notifications
         WHERE type = 'appointment_reminder' AND channel = 'in_app'`,
    );
    expect(rows[0]!.title).toBe("Your upcoming consultation");
  });
});

describe("appointment reminders", () => {
  /** An appointment inside the 24-hour reminder window. */
  const dueAt = (now: Date) => new Date(now.getTime() + REMINDER_LEAD_HOURS * 3_600_000 + 60_000);

  it("notifies the patient once", async () => {
    const now = new Date();
    await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: dueAt(now).toISOString(),
      status: "confirmed",
    });

    const first = await sendReminders(now);
    expect(first.skipped).toBe(false);
    expect(first.processed).toBe(1);

    /*
     * Count the in-app rows, not every row. One reminder can legitimately
     * write several: the in_app record plus a copy on each channel the
     * account asked for. The property under test is that the patient was
     * told once, not that exactly one row exists.
     */
    const { rows } = await world.h.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications
         WHERE type = 'appointment_reminder' AND channel = 'in_app'`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it("does nothing on a second run in the same window", async () => {
    const now = new Date();
    await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: dueAt(now).toISOString(),
      status: "confirmed",
    });

    await sendReminders(now);
    const second = await sendReminders(now);

    // Claimed by the first run, so the second does not even look.
    expect(second.skipped).toBe(true);
    expect(second.processed).toBe(0);
  });

  it("still sends only one notification if the run claim is bypassed", async () => {
    const now = new Date();
    await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: dueAt(now).toISOString(),
      status: "confirmed",
    });

    await sendReminders(now);
    // Simulate the run ledger being lost — the dedupe key must still hold.
    await world.h.client.exec(`DELETE FROM job_runs;`);
    await sendReminders(now);

    const { rows } = await world.h.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications
         WHERE type = 'appointment_reminder' AND channel = 'in_app'`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it("ignores appointments outside the window", async () => {
    const now = new Date();
    await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
      status: "confirmed",
    });

    const result = await sendReminders(now);
    expect(result.processed).toBe(0);
  });

  it("ignores cancelled appointments", async () => {
    const now = new Date();
    await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: dueAt(now).toISOString(),
      status: "cancelled",
    });

    const result = await sendReminders(now);
    expect(result.processed).toBe(0);
  });
});

describe("no-show sweep", () => {
  /** An appointment that ended comfortably outside the grace period. */
  const lapsed = (now: Date) =>
    new Date(now.getTime() - (NO_SHOW_GRACE_MINUTES + 90) * 60_000).toISOString();

  it("marks an unattended appointment as a no-show", async () => {
    const now = new Date();
    const id = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: lapsed(now),
      status: "confirmed",
    });

    const result = await sweepNoShows(now);
    expect(result.processed).toBe(1);

    const { rows } = await world.h.client.query<{ status: string }>(
      `SELECT status FROM appointments WHERE id = '${id}'`,
    );
    expect(rows[0]!.status).toBe("no_show");
  });

  it("leaves a completed appointment alone", async () => {
    const now = new Date();
    const id = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: lapsed(now),
      status: "completed",
    });

    await sweepNoShows(now);

    const { rows } = await world.h.client.query<{ status: string }>(
      `SELECT status FROM appointments WHERE id = '${id}'`,
    );
    expect(rows[0]!.status).toBe("completed");
  });

  it("respects the grace period", async () => {
    const now = new Date();
    await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      // Ended five minutes ago — inside the grace period.
      startUtc: new Date(now.getTime() - 35 * 60_000).toISOString(),
      minutes: 30,
      status: "confirmed",
    });

    const result = await sweepNoShows(now);
    expect(result.processed).toBe(0);
  });

  it("notifies the patient exactly once across repeated runs", async () => {
    const now = new Date();
    await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: lapsed(now),
      status: "confirmed",
    });

    await sweepNoShows(now);
    await world.h.client.exec(`DELETE FROM job_runs;`);
    await sweepNoShows(now);

    const { rows } = await world.h.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications
         WHERE type = 'appointment_no_show' AND channel = 'in_app'`,
    );
    expect(rows[0]!.n).toBe(1);
  });
});

describe("expiry sweep", () => {
  it("removes expired sessions and leaves live ones", async () => {
    await world.h.client.exec(`
      INSERT INTO sessions (user_id, token_hash, csrf_secret, expires_at)
      VALUES ('${world.patientA.userId}', 'stale-hash', 'x', now() - interval '2 days');
    `);

    const before = await world.h.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sessions`,
    );
    const result = await sweepExpired(new Date());
    expect(result.processed).toBeGreaterThan(0);

    const after = await world.h.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sessions`,
    );
    expect(after.rows[0]!.n).toBeLessThan(before.rows[0]!.n);

    // The live fixture sessions survive.
    const live = await world.h.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sessions WHERE expires_at > now()`,
    );
    expect(live.rows[0]!.n).toBeGreaterThan(0);
  });

  it("never touches clinical data", async () => {
    await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: "2020-01-01T10:00:00Z",
      status: "completed",
    });
    await world.h.client.exec(`
      INSERT INTO medical_records (patient_id, author_role, author_display_name, title)
      VALUES ('${world.patientA.patientId}', 'patient', 'A', 'Old record');
    `);

    await sweepExpired(new Date());

    const appointments = await world.h.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM appointments`,
    );
    const records = await world.h.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM medical_records`,
    );
    expect(appointments.rows[0]!.n).toBe(1);
    expect(records.rows[0]!.n).toBe(1);
  });
});
