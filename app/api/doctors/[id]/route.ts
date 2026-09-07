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

    return ok({ doctor, reviews: await clinical.listReviews(doctor.id) });
  },
);
