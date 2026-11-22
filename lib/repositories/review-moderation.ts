import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import * as t from "../db/schema";
import { AppError } from "../errors";

/** Admin history: pending, published and declined reviews, newest first. */
export async function listReviewsForModeration() {
  return getDb().select({ id: t.reviews.id, rating: t.reviews.rating, comment: t.reviews.comment,
    status: t.reviews.status, createdAt: t.reviews.createdAt, doctorName: t.doctors.displayName, patientName: t.patients.displayName,
  }).from(t.reviews).innerJoin(t.doctors, eq(t.reviews.doctorId, t.doctors.id))
    .innerJoin(t.patients, eq(t.reviews.patientId, t.patients.id))
    .orderBy(desc(t.reviews.createdAt));
}

export async function moderateReview(id: string, approve: boolean, adminId: string) {
  await getDb().transaction(async (tx) => {
    const [review] = await tx.select().from(t.reviews).where(eq(t.reviews.id, id));
    if (!review) throw new AppError("NOT_FOUND");
    // Serialize rating updates across concurrent decisions for the same doctor.
    await tx.select({ id: t.doctors.id }).from(t.doctors).where(eq(t.doctors.id, review.doctorId)).for("update");
    const changed = await tx.update(t.reviews).set({ status: approve ? "published" : "removed", moderatedByUserId: adminId, moderatedAt: new Date() })
      .where(and(eq(t.reviews.id, id), eq(t.reviews.status, "pending_moderation"))).returning({ id: t.reviews.id });
    if (!changed.length) throw new AppError("NOT_ELIGIBLE");
    const [rating] = await tx.select({ count: sql<number>`count(*)::int`, average: sql<string>`coalesce(round(avg(${t.reviews.rating}), 2), 0)::text` })
      .from(t.reviews).where(and(eq(t.reviews.doctorId, review.doctorId), eq(t.reviews.status, "published")));
    await tx.update(t.doctors).set({ ratingCount: rating!.count, ratingAvg: rating!.average }).where(eq(t.doctors.id, review.doctorId));
  });
}
