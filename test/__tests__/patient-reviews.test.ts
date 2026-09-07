/**
 * A patient's review, from writing it to another patient reading it.
 *
 * The security tests already pin what must not happen — reviewing somebody
 * else's appointment, a visit that never took place, the same visit twice.
 * This walks the path that must happen: one patient reviews a consultation
 * they actually had, and a different patient opening that doctor's profile
 * sees it, with the rating on the profile reflecting it.
 */
import { GET as doctorGet } from "../../app/api/doctors/[id]/route";
import { GET as reviewsGet, POST as reviewPost } from "../../app/api/reviews/route";
import { eq } from "drizzle-orm";
import * as t from "../../lib/db/schema";
import { setupWorld, teardownWorld, call, params } from "../harness";
import { requestAs, seedAppointment, type World } from "../fixtures";

const BASE = "http://localhost:3000";

let world: World;

beforeEach(async () => {
  world = await setupWorld();
});

afterEach(async () => {
  await teardownWorld(world);
});

/** A finished consultation between patientA and the fixture doctor. */
const completedVisit = (): Promise<string> =>
  seedAppointment(world, {
    doctor: world.doctor,
    patient: world.patientA,
    startUtc: "2026-01-05T10:00:00Z",
    status: "completed",
  });

describe("a patient reviews a doctor, and other patients see it", () => {
  it("shows the written review on the doctor's public profile", async () => {
    const appointmentId = await completedVisit();

    const written = await call(
      reviewPost,
      requestAs(world.patientA, `${BASE}/api/reviews`, {
        method: "POST",
        body: JSON.stringify({
          appointmentId,
          rating: 5,
          comment: "Explained everything clearly and never rushed me.",
        }),
      }),
    );
    expect(written.status).toBe(201);

    // A different patient opens the profile — the review is there for them.
    const profile = await call<{
      doctor: { ratingCount: number; rating: number };
      reviews: { rating: number; comment: string; patientName: string }[];
    }>(
      doctorGet,
      requestAs(world.patientB, `${BASE}/api/doctors/${world.doctor.doctorId}`),
      params({ id: world.doctor.doctorId! }),
    );

    expect(profile.status).toBe(200);
    expect(profile.body.reviews).toHaveLength(1);
    expect(profile.body.reviews[0]).toMatchObject({
      rating: 5,
      comment: "Explained everything clearly and never rushed me.",
    });
  });

  it("counts the review towards the doctor's rating", async () => {
    const [before] = await world.h.db
      .select({ count: t.doctors.ratingCount })
      .from(t.doctors)
      .where(eq(t.doctors.id, world.doctor.doctorId!));

    const appointmentId = await completedVisit();
    await call(
      reviewPost,
      requestAs(world.patientA, `${BASE}/api/reviews`, {
        method: "POST",
        body: JSON.stringify({ appointmentId, rating: 4, comment: "Good visit." }),
      }),
    );

    const [after] = await world.h.db
      .select({ count: t.doctors.ratingCount })
      .from(t.doctors)
      .where(eq(t.doctors.id, world.doctor.doctorId!));

    expect(after!.count).toBe(before!.count + 1);
  });

  it("is readable without signing in — the directory is public", async () => {
    const appointmentId = await completedVisit();
    await call(
      reviewPost,
      requestAs(world.patientA, `${BASE}/api/reviews`, {
        method: "POST",
        body: JSON.stringify({ appointmentId, rating: 5, comment: "Very helpful." }),
      }),
    );

    const res = await call<{ reviews: { comment: string }[] }>(
      reviewsGet,
      requestAs(null, `${BASE}/api/reviews?doctorId=${world.doctor.doctorId}`),
    );

    expect(res.status).toBe(200);
    expect(res.body.reviews).toHaveLength(1);
  });

  it("does not attach the reviewer's contact details to what is published", async () => {
    const appointmentId = await completedVisit();
    await call(
      reviewPost,
      requestAs(world.patientA, `${BASE}/api/reviews`, {
        method: "POST",
        body: JSON.stringify({ appointmentId, rating: 5, comment: "Thank you." }),
      }),
    );

    const res = await call(
      reviewsGet,
      requestAs(null, `${BASE}/api/reviews?doctorId=${world.doctor.doctorId}`),
    );

    // A review is published under a display name and nothing more.
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain(world.patientA.email);
  });
});
