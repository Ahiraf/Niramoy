/**
 * GET /api/doctors/:id — one profile, with its published reviews.
 */
import { ok, withRoute } from "../../../../lib/api/respond";
import { AppError } from "../../../../lib/errors";
import * as clinical from "../../../../lib/repositories/clinical";
import * as directory from "../../../../lib/repositories/doctors";

export const dynamic = "force-dynamic";

export const GET = withRoute(
  "GET /api/doctors/[id]",
  async (_request, _context, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const doctor = await directory.getDoctor(id);
    if (!doctor) throw new AppError("DOCTOR_NOT_FOUND");

    const availability = await directory.getAvailability(doctor.id);
    const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    return ok({ doctor: { ...doctor, availability: availability.map((rule) => ({ ...rule, localStart: clock(rule.startMinute), localEnd: clock(rule.endMinute) })) }, reviews: await clinical.listReviews(doctor.id) });
  },
);
