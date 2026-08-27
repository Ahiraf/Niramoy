/**
 * Concurrency tests — brief §39.
 *
 * REQUIRES A REAL POSTGRESQL SERVER. PGlite is single-connection: it serialises
 * everything, so it would pass these tests without proving anything. A test
 * that cannot fail is worse than no test, so this suite skips loudly rather
 * than pretending.
 *
 *   docker compose up -d
 *   export DATABASE_URL_TEST=postgresql://niramoy:niramoy@localhost:5433/niramoy_test
 *   npm run test:concurrency
 */
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";

import { __setTestDatabase, type Database } from "../../lib/db/client";
import * as t from "../../lib/db/schema";
import * as appointments from "../../lib/repositories/appointments";
import { isAppointmentConflict } from "../../lib/db/errors";
import { withRetry } from "../../lib/db/retry";

const CONNECTION = process.env.DATABASE_URL_TEST;

/**
 * Skipping silently would let a green run hide the fact that the single most
 * important correctness property was never exercised.
 */
const describeIfPostgres = CONNECTION ? describe : describe.skip;

if (!CONNECTION) {
  console.warn(
    "\n  ⚠ CONCURRENCY TESTS SKIPPED — DATABASE_URL_TEST is not set.\n" +
      "    These prove that exactly one of N simultaneous bookings succeeds.\n" +
      "    Start a real server (docker compose up -d) and set DATABASE_URL_TEST.\n",
  );
}

const DOCTOR = "11111111-1111-4111-8111-111111111111";
const SLOT_START = new Date("2027-03-01T10:00:00Z");

let pool: Pool;
let db: NodePgDatabase<typeof t>;

describeIfPostgres("concurrent booking", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: CONNECTION, max: 20 });
    db = drizzle(pool, { schema: t, casing: "snake_case" });
    await migrate(db as never, { migrationsFolder: "./lib/db/migrations" });
    __setTestDatabase(db as unknown as Database);
  });

  afterAll(async () => {
    __setTestDatabase(undefined);
    await pool.end();
  });

  beforeEach(async () => {
    await db.execute(sql`
      TRUNCATE appointments, patients, doctors, specialties, districts, divisions,
               users, appointment_status_history, notifications, audit_logs
      RESTART IDENTITY CASCADE
    `);
    await db.execute(sql`
      INSERT INTO divisions (id, name) VALUES ('dhaka', 'Dhaka');
      INSERT INTO districts (id, division_id, name) VALUES ('dhaka', 'dhaka', 'Dhaka');
      INSERT INTO specialties (id, name) VALUES ('cardiology', 'Cardiology');
      INSERT INTO doctors (id, display_name, initials, slug, primary_specialty_id,
                           consultation_minutes, verification_status, is_demo_profile)
        VALUES ('${sql.raw(DOCTOR)}', 'Dr Load', 'DL', 'dr-load', 'cardiology', 30,
                'verified', true);
    `);
  });

  /** N distinct patients, so only the doctor-side constraint is in play. */
  async function makePatients(count: number): Promise<string[]> {
    const rows = await db
      .insert(t.patients)
      .values(
        Array.from({ length: count }, (_, i) => ({
          patientCode: `NRM-C-${i}`,
          displayName: `Patient ${i}`,
        })),
      )
      .returning({ id: t.patients.id });
    return rows.map((r) => r.id);
  }

  /**
   * One booking attempt, through the REAL repository — advisory lock, exclusion
   * constraint and all — wrapped in the production retry policy.
   *
   * Deliberately not raw SQL. An earlier version of this test inserted directly
   * and reproduced a persistent deadlock under a twelve-way overlapping burst
   * that four retries could not clear. That finding is what put the per-doctor
   * advisory lock in appointments.insert(); testing anything other than the
   * real path would have hidden it.
   */
  async function attempt(patientId: string, start: Date, minutes: number): Promise<"ok" | "conflict"> {
    return withRetry(
      async () => {
        try {
          await appointments.insert(
            {
              reference: `REF-${patientId.slice(0, 8)}-${start.getTime()}`,
              doctorId: DOCTOR,
              patientId,
              bookedByUserId: null as unknown as string,
              startUtc: start,
              endUtc: new Date(start.getTime() + minutes * 60_000),
              durationMinutes: minutes,
              feeAmount: "800",
            },
            db as unknown as Database,
          );
          return "ok" as const;
        } catch (err) {
          // A conflict is a business outcome, not something to retry.
          if (isAppointmentConflict(err)) return "conflict" as const;
          throw err;
        }
      },
      { label: "concurrency-test-booking" },
    );
  }

  /* ---- §39, case 1 ------------------------------------------------------- */

  it("lets exactly one of ten simultaneous bookings for the same slot succeed", async () => {
    const patients = await makePatients(10);

    // Fired together on ten separate connections — genuinely concurrent, not
    // interleaved on one.
    const results = await Promise.all(
      patients.map((patientId) => attempt(patientId, SLOT_START, 30)),
    );

    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "conflict")).toHaveLength(9);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM appointments WHERE doctor_id = $1`,
      [DOCTOR],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  /* ---- §39, case 2 ------------------------------------------------------- */

  it("rejects an overlapping booking of a different duration", async () => {
    const [a, b] = await makePatients(2);

    // 10:00-10:30, then 10:15-10:45. Different start times, so the unique
    // index permits the second; only the exclusion constraint stops it.
    expect(await attempt(a!, new Date("2027-03-01T10:00:00Z"), 30)).toBe("ok");
    expect(await attempt(b!, new Date("2027-03-01T10:15:00Z"), 30)).toBe("conflict");
  });

  it("allows a booking that merely abuts another", async () => {
    const [a, b] = await makePatients(2);
    expect(await attempt(a!, new Date("2027-03-01T10:00:00Z"), 30)).toBe("ok");
    expect(await attempt(b!, new Date("2027-03-01T10:30:00Z"), 30)).toBe("ok");
  });

  it("survives a burst of overlapping intervals at staggered offsets", async () => {
    const patients = await makePatients(12);

    // Every one of these overlaps 10:00-11:00 somewhere.
    const results = await Promise.all(
      patients.map((patientId, i) =>
        attempt(patientId, new Date(SLOT_START.getTime() + i * 5 * 60_000), 30),
      ),
    );

    const accepted = results.filter((r) => r === "ok").length;
    // Some non-overlapping ones may get in; what must hold is that the accepted
    // set is itself free of overlaps.
    expect(accepted).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n
         FROM appointments a JOIN appointments b
           ON a.id <> b.id
          AND a.doctor_id = b.doctor_id
          AND tstzrange(a.start_utc, a.end_utc, '[)') && tstzrange(b.start_utc, b.end_utc, '[)')
        WHERE a.status NOT IN ('cancelled','no_show')
          AND b.status NOT IN ('cancelled','no_show')`,
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("stops one patient being booked with two doctors at once", async () => {
    const [patientId] = await makePatients(1);
    await db.execute(sql`
      INSERT INTO doctors (id, display_name, initials, slug, primary_specialty_id,
                           verification_status, is_demo_profile)
      VALUES ('22222222-2222-4222-8222-222222222222', 'Dr Two', 'DT', 'dr-two',
              'cardiology', 'verified', true);
    `);

    expect(await attempt(patientId!, SLOT_START, 30)).toBe("ok");

    const client = await pool.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO appointments
             (reference, doctor_id, patient_id, start_utc, end_utc, duration_minutes, status)
           VALUES ('X', '22222222-2222-4222-8222-222222222222', $1, $2, $3, 30, 'confirmed')`,
          [patientId, SLOT_START, new Date(SLOT_START.getTime() + 30 * 60_000)],
        ),
      ).rejects.toThrow();
    } finally {
      client.release();
    }
  });

  it("frees the interval for a new booking once the first is cancelled", async () => {
    const [a, b] = await makePatients(2);

    expect(await attempt(a!, SLOT_START, 30)).toBe("ok");
    expect(await attempt(b!, SLOT_START, 30)).toBe("conflict");

    await pool.query(`UPDATE appointments SET status = 'cancelled' WHERE doctor_id = $1`, [DOCTOR]);

    expect(await attempt(b!, SLOT_START, 30)).toBe("ok");
  });
});
