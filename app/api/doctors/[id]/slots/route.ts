/**
 * GET /api/doctors/:id/slots — bookable slots, grouped by local day.
 *
 * Advisory only. A slot listed here may be gone by the time it is booked; the
 * database's exclusion constraint is what actually decides (see
 * lib/services/booking.ts).
 */
import { ok, query, withRoute } from "../../../../../lib/api/respond";
import { getEnv } from "../../../../../lib/config/env";
import { AppError } from "../../../../../lib/errors";
import * as directory from "../../../../../lib/repositories/doctors";
import { describeSlot } from "../../../../../lib/scheduling/engine";
import { availableSlots } from "../../../../../lib/services/booking";

export const dynamic = "force-dynamic";

export const GET = withRoute(
  "GET /api/doctors/[id]/slots",
  async (request, _context, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!(await directory.getDoctor(id))) throw new AppError("DOCTOR_NOT_FOUND");

    const days = Number(query(request).days ?? 14);
    const slots = await availableSlots(id, { days });
    const zone = getEnv().DISPLAY_TIMEZONE;

    const byDay = new Map<string, { dateKey: string; day: string; date: string; month: string; slots: unknown[] }>();
    for (const slot of slots) {
      const described = describeSlot(slot, zone);
      if (!byDay.has(described.dateKey)) {
        byDay.set(described.dateKey, {
          dateKey: described.dateKey,
          day: described.day,
          date: described.date,
          month: described.month,
          slots: [],
        });
      }
      byDay.get(described.dateKey)!.slots.push({ ...described, localLabel: described.localLabel });
    }

    return ok({ total: slots.length, days: [...byDay.values()] });
  },
);
