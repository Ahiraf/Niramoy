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
import { GET as doctorReviewsGet } from "../../app/api/doctor/reviews/route";
import { GET as reviewsGet, POST as reviewPost } from "../../app/api/reviews/route";
import { GET as moderationGet, PATCH as moderationPatch } from "../../app/api/admin/reviews/route";
import { eq } from "drizzle-orm";
import * as t from "../../lib/db/schema";
import { setupWorld, teardownWorld, call, params } from "../harness";
import { requestAs, seedAppointment, type World } from "../fixtures";

const BASE = "http://localhost:3000";

async function approvePending() {
  const queue = await call<{ reviews: { id: string; status: string }[] }>(moderationGet, requestAs(world.admin, `${BASE}/api/admin/reviews`));
  for (const review of queue.body.reviews.filter((review) => review.status === "pending_moderation")) {
    const result = await call(moderationPatch, requestAs(world.admin, `${BASE}/api/admin/reviews`, { method: "PATCH", body: JSON.stringify({ id: review.id, approve: true }) }));
    expect(result.status).toBe(200);
  }
}

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
  it("keeps pending and rejected reviews private and restricts moderation to admins", async () => {
    const appointmentId = await completedVisit();
    const written = await call<{ review: { id: string } }>(reviewPost, requestAs(world.patientA, `${BASE}/api/reviews`, {
      method: "POST", body: JSON.stringify({ appointmentId, rating: 5, comment: "Pending feedback" }),
    }));
    const before = await call<{ reviews: unknown[] }>(doctorReviewsGet, requestAs(world.doctor, `${BASE}/api/doctor/reviews`));
    expect(before.body.reviews).toEqual([]);
    const publicResult = await call<{ reviews: unknown[] }>(reviewsGet, requestAs(null, `${BASE}/api/reviews?doctorId=${world.doctor.doctorId}`));
    expect(publicResult.body.reviews).toEqual([]);
    for (const actor of [world.patientA, world.doctor]) {
      expect((await call(moderationGet, requestAs(actor, `${BASE}/api/admin/reviews`))).status).toBe(403);
      expect((await call(moderationPatch, requestAs(actor, `${BASE}/api/admin/reviews`, { method: "PATCH", body: JSON.stringify({ id: written.body.review.id, approve: true }) }))).status).toBe(403);
    }
    const rejected = await call(moderationPatch, requestAs(world.admin, `${BASE}/api/admin/reviews`, { method: "PATCH", body: JSON.stringify({ id: written.body.review.id, approve: false }) }));
    expect(rejected.status).toBe(200);
    const history = await call<{ reviews: { id: string; status: string }[] }>(moderationGet, requestAs(world.admin, `${BASE}/api/admin/reviews`));
    expect(history.body.reviews).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: written.body.review.id, status: "removed" }),
    ]));
    const [stored] = await world.h.db.select().from(t.reviews).where(eq(t.reviews.id, written.body.review.id));
    expect(stored?.status).toBe("removed");
    const repeated = await call(moderationPatch, requestAs(world.admin, `${BASE}/api/admin/reviews`, { method: "PATCH", body: JSON.stringify({ id: written.body.review.id, approve: true }) }));
    expect(repeated.status).toBe(422);
  });
  it("lets the doctor see their own published reviews only", async () => {
    const appointmentId = await completedVisit();
    await call(
      reviewPost,
      requestAs(world.patientA, `${BASE}/api/reviews`, {
        method: "POST",
        body: JSON.stringify({ appointmentId, rating: 5, comment: "Very clear advice." }),
      }),
    );

    await approvePending();
    const own = await call<{ reviews: { rating: number; comment: string; patientName: string }[] }>(
      doctorReviewsGet,
      requestAs(world.doctor, `${BASE}/api/doctor/reviews?doctorId=${world.otherDoctor.doctorId}`),
    );
    expect(own.status).toBe(200);
    expect(own.body.reviews).toHaveLength(1);
    expect(own.body.reviews[0]).toMatchObject({ rating: 5, comment: "Very clear advice." });

    const other = await call<{ reviews: unknown[] }>(
      doctorReviewsGet,
      requestAs(world.otherDoctor, `${BASE}/api/doctor/reviews`),
    );
    expect(other.status).toBe(200);
    expect(other.body.reviews).toHaveLength(0);
  });

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

    await approvePending();
    // A different patient sees the approved review.
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

    await approvePending();
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

    await approvePending();
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

    await approvePending();
    const res = await call(
      reviewsGet,
      requestAs(null, `${BASE}/api/reviews?doctorId=${world.doctor.doctorId}`),
    );

    // A review is published under a display name and nothing more.
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain(world.patientA.email);
  });
});
