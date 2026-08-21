import { getDoctor, getDoctorSlots } from "../../../../../lib/store.js";
import { boot, ok, fail, query } from "../../../_lib.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/doctors/:id/slots?days=14
 * Slots come straight from lib/scheduling.js — rules − exceptions − booked −
 * past/too-soon — grouped by day for the booking calendar.
 */
export async function GET(request, { params }) {
  boot();
  const { id } = await params;
  if (!getDoctor(id)) return fail("doctor_not_found", 404);

  const days = Number(query(request).days ?? 14);
  const slots = getDoctorSlots(id, { days });

  const byDay = new Map();
  for (const slot of slots) {
    if (!byDay.has(slot.dateKey)) {
      byDay.set(slot.dateKey, {
        dateKey: slot.dateKey,
        day: slot.day,
        date: slot.date,
        month: slot.month,
        slots: [],
      });
    }
    byDay.get(slot.dateKey).slots.push(slot);
  }

  return ok({ total: slots.length, days: [...byDay.values()] });
}
