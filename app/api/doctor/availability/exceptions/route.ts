/**
 * /api/doctor/availability/exceptions — date-specific availability.
 *
 * Two things live here, and they are opposites:
 *
 *   - `extra`: a one-off clinic on one date. It stands on its own — a doctor
 *     with no weekly schedule at all can publish one, which is the whole point
 *     of being able to open an evening for a single Thursday.
 *   - `block`: time taken away. With no window it removes the whole day (leave,
 *     a holiday); with one it removes just that range and leaves the rest of the
 *     day bookable, so a 14:00–15:00 hospital round does not cost the morning.
 *
 * `extra` wins over a whole-day `block`, which is how a doctor adds one clinic
 * during a week of leave. That precedence is the engine's, not this route's.
 *
 * Everything is expressed in the doctor's own zone and stored as a local date
 * plus minutes from local midnight. Instants stay UTC and are computed at slot
 * generation — nothing here writes a timestamp.
 */
import { json, ok, withRoute } from "../../../../../lib/api/respond";
import { getEnv } from "../../../../../lib/config/env";
import { AppError } from "../../../../../lib/errors";
import * as directory from "../../../../../lib/repositories/doctors";
import { localDateKey } from "../../../../../lib/scheduling/engine";
import {
  assertWindow,
  formatTimeMinutes,
  minutesOverlap,
  parseFutureDateKey,
  parseInteger,
  parseTimeMinutes,
} from "../../../../../lib/scheduling/input";
import { requireVerifiedDoctor } from "../../../../../lib/security/authz";

export const dynamic = "force-dynamic";

function present(row: directory.AvailabilityExceptionRow) {
  return {
    id: row.id,
    date: row.date,
    type: row.type,
    localStart: row.startMinute == null ? null : formatTimeMinutes(row.startMinute),
    localEnd: row.endMinute == null ? null : formatTimeMinutes(row.endMinute),
    slotMinutes: row.slotMinutes,
    bufferMinutes: row.bufferMinutes,
    timezone: row.timezone,
    reason: row.reason,
    /** True for a block covering the entire day rather than a range of it. */
    allDay: row.type === "block" && row.startMinute == null,
  };
}

export const GET = withRoute("GET /api/doctor/availability/exceptions", async (request) => {
  const profile = await requireVerifiedDoctor(request);
  const zone = getEnv().DISPLAY_TIMEZONE;

  // From today onward. A doctor reviewing their schedule is looking forward,
  // and last month's blocked afternoons are noise they cannot act on.
  const rows = await directory.listExceptions(profile.id, localDateKey(new Date(), zone));
  return ok({ exceptions: rows.map(present), timezone: zone });
});

export const POST = withRoute("POST /api/doctor/availability/exceptions", async (request) => {
  const profile = await requireVerifiedDoctor(request);
  const body = await json<Record<string, unknown>>(request, 8192);
  const zone = getEnv().DISPLAY_TIMEZONE;

  const type = String(body.type ?? "extra");
  if (type !== "extra" && type !== "block") {
    throw new AppError("VALIDATION_FAILED", {
      details: { type: ["Choose extra hours or a block."] },
    });
  }

  const dateKey = parseFutureDateKey(body.date, "date", zone);

  /*
   * A whole-day block is the only entry with no window. Everything else needs
   * one, and an `extra` with no hours would be a clinic nobody could book.
   */
  const wholeDay = type === "block" && !body.localStart && !body.localEnd;

  let startMinute: number | null = null;
  let endMinute: number | null = null;
  let slotMinutes: number | null = null;
  let bufferMinutes: number | null = null;

  if (!wholeDay) {
    startMinute = parseTimeMinutes(body.localStart, "localStart");
    endMinute = parseTimeMinutes(body.localEnd, "localEnd");

    if (type === "extra") {
      slotMinutes = parseInteger(body.slotMinutes ?? 20, "slotMinutes", 5, 120);
      bufferMinutes = parseInteger(body.bufferMinutes ?? 0, "bufferMinutes", 0, 60);
      assertWindow(startMinute, endMinute, slotMinutes, {
        end: "localEnd",
        slot: "slotMinutes",
      });
    } else if (endMinute <= startMinute) {
      // A block needs no slot length — it creates nothing — but a zero-length
      // one would silently block nothing at all.
      throw new AppError("VALIDATION_FAILED", {
        details: { localEnd: ["The end time must be after the start time."] },
      });
    }
  }

  /*
   * Overlap is refused for `extra` only.
   *
   * Two extra clinics on the same date fighting over the same hour produce
   * slots at two different lengths starting at the same minute, and only one of
   * them can be booked — the engine keeps the first it sees. Blocks are exempt
   * because overlapping is what a block is FOR: subtracting the same hour twice
   * subtracts it once.
   */
  if (type === "extra" && startMinute != null && endMinute != null) {
    const sameDate = (await directory.listExceptions(profile.id, dateKey)).filter(
      (row) => row.date === dateKey && row.type === "extra",
    );
    const clash = sameDate.some(
      (row) =>
        row.startMinute != null &&
        row.endMinute != null &&
        minutesOverlap(startMinute!, endMinute!, row.startMinute, row.endMinute),
    );
    if (clash) {
      throw new AppError("ALREADY_EXISTS", {
        message: "You already have extra hours covering part of that time.",
      });
    }
  }

  const reason = String(body.reason ?? "").trim().slice(0, 200) || null;

  const row = await directory.addException(profile.id, {
    dateKey,
    type,
    startMinute,
    endMinute,
    slotMinutes,
    bufferMinutes,
    timezone: zone,
    reason,
  });

  return ok({ exception: present(row) }, { status: 201 });
});

export const DELETE = withRoute("DELETE /api/doctor/availability/exceptions", async (request) => {
  const profile = await requireVerifiedDoctor(request);
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) {
    throw new AppError("VALIDATION_FAILED", { details: { id: ["Which entry should be removed?"] } });
  }

  const removed = await directory.deleteException(profile.id, id);
  if (!removed) throw new AppError("NOT_FOUND");

  return ok({ removed: true });
});
