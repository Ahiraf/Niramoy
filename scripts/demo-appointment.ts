/**
 * Niramoy — put a consultation on the clock, right now
 *
 *   npm run demo:live            # starts 2 minutes ago, runs for 20 minutes
 *   npm run demo:live -- --in 5  # starts 5 minutes from now
 *   npm run demo:live -- --minutes 45   # a longer room, for a long viva
 *
 * WHY THIS EXISTS
 * A consultation room only opens JOIN_OPENS_MINUTES_BEFORE (15) minutes before
 * the appointment and closes JOIN_CLOSES_MINUTES_AFTER (30) minutes after it —
 * see lib/services/video.ts. That rule is the point: a token is permission to
 * attend a consultation that is happening now, not a standing key to a room.
 *
 * So a demo does not need the rule relaxed. It needs an appointment whose time
 * is now. This script books one directly, between the two seeded demo accounts,
 * so both sides of the call can be shown from one machine.
 *
 * It writes only demo data and refuses to run when demo profiles are disabled,
 * which is the production default. Re-running it moves the same appointment
 * rather than piling up new ones.
 */
import "./_bootstrap";

import { eq } from "drizzle-orm";

import { getEnv } from "../lib/config/env";
import { closeDb, getDb } from "../lib/db/client";
import { getVideoProvider } from "../lib/video/provider";
import * as t from "../lib/db/schema";
import { JOIN_OPENS_MINUTES_BEFORE, JOIN_CLOSES_MINUTES_AFTER } from "../lib/services/video";

/** Stable reference, so a second run updates rather than duplicates. */
const REFERENCE = "NRM-DEMO-LIVE";
const PATIENT_EMAIL = "nabila@example.com";
const DOCTOR_EMAIL = "ayesha@example.com";

/**
 * PGlite is an EMBEDDED database: it lives inside whichever process opened it,
 * and two processes do not share one. So a `next dev` server started before
 * this script keeps serving the snapshot it loaded at boot, and the appointment
 * we just wrote is invisible to it — the doctor's schedule comes back empty and
 * it reads like a bug in the app.
 *
 * There is no lock to take, so the best we can do is notice the server is up
 * and say what to do about it.
 */
async function warnIfDevServerIsHoldingTheDatabase(): Promise<void> {
  const env = getEnv();
  if (env.databaseDriver !== "pglite") return; // a real server has no such problem

  const reachable = await fetch(env.APP_URL, { signal: AbortSignal.timeout(1500) })
    .then(() => true)
    .catch(() => false);

  if (!reachable) return;

  console.warn(
    [
      "",
      `WARNING  A dev server is running at ${env.APP_URL}, and the database is`,
      "         the in-process one (PGlite). It cannot see this appointment",
      "         until you restart it: stop `npm run dev`, then start it again.",
      "         Set DATABASE_URL to a real PostgreSQL server and this goes away.",
      "",
    ].join("\n"),
  );
}

/** `--in 5` / `--in=5`. Returns the fallback when absent or unparseable. */
function numericFlag(name: string, fallback: number): number {
  const args = process.argv.slice(2);
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return fallback;
  const raw = args[i]!.includes("=") ? args[i]!.split("=")[1] : args[i + 1];
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const fmt = (d: Date, tz: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short",
  }).format(d);

async function main(): Promise<void> {
  const env = getEnv();

  if (!env.allowDemoProfiles) {
    throw new Error(
      "Refusing to run: ALLOW_DEMO_PROFILES is false. This script books a " +
        "synthetic appointment and must never touch a production schedule.",
    );
  }

  const db = getDb();

  // Start slightly in the past by default: the room is open, and the
  // appointment reads as in progress rather than upcoming.
  const startsInMinutes = numericFlag("in", -2);
  const durationMinutes = Math.max(5, Math.round(numericFlag("minutes", 20)));

  const start = new Date(Date.now() + startsInMinutes * 60_000);
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + durationMinutes * 60_000);

  /* ---- The two demo participants ---------------------------------------- */

  const [patientUser] = await db
    .select({ id: t.users.id })
    .from(t.users)
    .where(eq(t.users.email, PATIENT_EMAIL))
    .limit(1);

  const [doctorUser] = await db
    .select({ id: t.users.id })
    .from(t.users)
    .where(eq(t.users.email, DOCTOR_EMAIL))
    .limit(1);

  if (!patientUser || !doctorUser) {
    throw new Error(`No demo accounts found. Run \`npm run db:seed\` first.`);
  }

  const [patient] = await db
    .select({ id: t.patients.id })
    .from(t.patients)
    .where(eq(t.patients.userId, patientUser.id))
    .limit(1);

  const [doctor] = await db
    .select({ id: t.doctors.id, fee: t.doctors.feeAmount, name: t.doctors.displayName })
    .from(t.doctors)
    .where(eq(t.doctors.userId, doctorUser.id))
    .limit(1);

  if (!patient || !doctor) {
    throw new Error("The demo accounts exist but their profiles do not. Re-run `npm run db:reset && npm run db:seed`.");
  }

  /* ---- Book it, or move the one we booked last time --------------------- */

  const [existing] = await db
    .select({ id: t.appointments.id, status: t.appointments.status })
    .from(t.appointments)
    .where(eq(t.appointments.reference, REFERENCE))
    .limit(1);

  let appointmentId: string;

  if (existing) {
    await db
      .update(t.appointments)
      .set({
        doctorId: doctor.id,
        patientId: patient.id,
        startUtc: start,
        endUtc: end,
        durationMinutes,
        status: "confirmed",
        type: "video",
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        cancelReason: null,
        updatedAt: new Date(),
      })
      .where(eq(t.appointments.id, existing.id));

    appointmentId = existing.id;

    // A room provisioned for the old time carries the old expiry. Drop it so
    // the next join mints a fresh one through the normal path.
    await db.delete(t.videoSessions).where(eq(t.videoSessions.appointmentId, appointmentId));

    if (existing.status !== "confirmed") {
      await db.insert(t.appointmentStatusHistory).values({
        appointmentId,
        fromStatus: existing.status,
        toStatus: "confirmed",
        reasonCode: "demo_script",
      });
    }
  } else {
    const [created] = await db
      .insert(t.appointments)
      .values({
        reference: REFERENCE,
        doctorId: doctor.id,
        patientId: patient.id,
        bookedByUserId: patientUser.id,
        startUtc: start,
        endUtc: end,
        durationMinutes,
        status: "confirmed",
        type: "video",
        reason: "Demonstration consultation",
        feeAmount: doctor.fee,
      })
      .returning({ id: t.appointments.id });

    appointmentId = created!.id;

    await db.insert(t.appointmentStatusHistory).values({
      appointmentId,
      toStatus: "confirmed",
      reasonCode: "demo_script",
    });
  }

  /* ---- Tell the presenter what they have -------------------------------- */

  const tz = env.DISPLAY_TIMEZONE;
  const opens = new Date(start.getTime() - JOIN_OPENS_MINUTES_BEFORE * 60_000);
  const closes = new Date(end.getTime() + JOIN_CLOSES_MINUTES_AFTER * 60_000);

  console.log(
    `\n✓ live consultation ready — ${REFERENCE}` +
      `\n  ${doctor.name} with Nabila Begum, ${fmt(start, tz)}–${fmt(end, tz)} (${tz})` +
      `\n  room open ${fmt(opens, tz)} → ${fmt(closes, tz)}` +
      `\n\n  patient: ${PATIENT_EMAIL}   doctor: ${DOCTOR_EMAIL}   password: niramoy123` +
      `\n  video provider: ${getVideoProvider().name}` +
      `\n\n  Sign in as the patient, open Appointments, and press “Join call”.` +
      `\n  Re-run this before the demo to move it back onto the clock.\n`,
  );

  await warnIfDevServerIsHoldingTheDatabase();
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("✗ demo appointment failed");
    console.error(err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
