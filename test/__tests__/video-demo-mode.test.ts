/**
 * DEMO_MODE and the consultation room.
 *
 * The room is normally joinable only in a window around the appointment, which
 * is correct and makes a demonstration impossible: the appointment being shown
 * is whatever is in the database, and it is rarely starting in the next fifteen
 * minutes.
 *
 * So DEMO_MODE lifts the window. The point of this file is that it lifts ONLY
 * the window — every test about who may join is run with demo mode ON, because
 * a flag that quietly widened the audience as well would be the dangerous kind
 * of convenience, and nothing in the happy path would reveal it.
 */
import { resetEnvCache } from "../../lib/config/env";
import { resetVideoProvider } from "../../lib/video/provider";
import { getJoinGrant } from "../../lib/services/video";
import type { Principal } from "../../lib/security/authz";
import { seedAppointment, type Actor, type World } from "../fixtures";
import { setupWorld, teardownWorld } from "../harness";

const ORIGINAL = { ...process.env };

let world: World;

beforeEach(async () => {
  world = await setupWorld();
});

afterEach(async () => {
  await teardownWorld(world);
  process.env = { ...ORIGINAL };
  resetEnvCache();
  resetVideoProvider();
});

function setDemoMode(on: boolean): void {
  if (on) process.env.DEMO_MODE = "true";
  else delete process.env.DEMO_MODE;
  resetEnvCache();
  resetVideoProvider();
}

/** The principal shape the service reads, built from a fixture actor. */
function principalOf(actor: Actor): Principal {
  return {
    userId: actor.userId,
    role: actor.role,
    name: actor.name,
    email: actor.email,
    patientId: actor.patientId,
  } as Principal;
}

/** An appointment far enough away that the join window is definitely shut. */
async function distantAppointment(patient: Actor = world.patientA): Promise<string> {
  return seedAppointment(world, {
    doctor: world.doctor,
    patient,
    startUtc: "2027-06-01T10:00:00Z",
    status: "confirmed",
  });
}

const context = { requestId: "test" };

describe("the join window", () => {
  it("is enforced when demo mode is off", async () => {
    setDemoMode(false);
    const appointmentId = await distantAppointment();

    await expect(
      getJoinGrant(principalOf(world.patientA), appointmentId, context),
    ).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });

  it("is lifted when demo mode is on", async () => {
    setDemoMode(true);
    const appointmentId = await distantAppointment();

    const grant = await getJoinGrant(principalOf(world.patientA), appointmentId, context);
    expect(grant.role).toBe("patient");
    expect(grant.demoMode).toBe(true);
    // Lifted, not removed: the room still stops existing at some point.
    expect(grant.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("puts both people in the same room", async () => {
    setDemoMode(true);
    const appointmentId = await distantAppointment();

    const patient = await getJoinGrant(principalOf(world.patientA), appointmentId, context);
    const doctor = await getJoinGrant(principalOf(world.doctor), appointmentId, context);

    expect(doctor.role).toBe("doctor");
    // The room is created server-side, bound to the appointment, and reused —
    // two participants who land in different rooms is a call that never happens.
    expect(doctor.url).toBe(patient.url);
  });
});

describe("demo mode does not widen who may join", () => {
  it("still refuses a patient who is not on the appointment", async () => {
    setDemoMode(true);
    const appointmentId = await distantAppointment(world.patientA);

    await expect(
      getJoinGrant(principalOf(world.patientB), appointmentId, context),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("still refuses a doctor who is not on the appointment", async () => {
    setDemoMode(true);
    const appointmentId = await distantAppointment();

    await expect(
      getJoinGrant(principalOf(world.otherDoctor), appointmentId, context),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("still refuses an admin, who has no place in a consultation", async () => {
    setDemoMode(true);
    const appointmentId = await distantAppointment();

    await expect(
      getJoinGrant(principalOf(world.admin), appointmentId, context),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("still refuses a cancelled consultation", async () => {
    setDemoMode(true);
    const appointmentId = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: "2027-06-01T10:00:00Z",
      status: "cancelled",
    });

    await expect(
      getJoinGrant(principalOf(world.patientA), appointmentId, context),
    ).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
  });
});
