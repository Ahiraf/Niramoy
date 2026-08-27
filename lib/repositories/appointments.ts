/**
 * Appointments.
 *
 * The booking path is the one place in this codebase where the database, not
 * the application, is the authority on correctness. Everything here is written
 * around that: we attempt the insert and let the exclusion constraint decide.
 */
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { getDb, type Database } from "../db/client";
import * as t from "../db/schema";
import type { Interval } from "../scheduling/engine";

/** Statuses that still occupy a doctor's time. */
export const LIVE_STATUSES = ["pending", "confirmed", "in_progress", "completed"] as const;

export interface AppointmentRow {
  id: string;
  reference: string;
  doctorId: string;
  patientId: string;
  bookedByUserId: string | null;
  familyMemberId: string | null;
  startUtc: Date;
  endUtc: Date;
  durationMinutes: number;
  status: string;
  type: string;
  reason: string | null;
  feeAmount: string;
  currency: string;
  rescheduleCount: number;
  createdAt: Date;
}

const columns = {
  id: t.appointments.id,
  reference: t.appointments.reference,
  doctorId: t.appointments.doctorId,
  patientId: t.appointments.patientId,
  bookedByUserId: t.appointments.bookedByUserId,
  familyMemberId: t.appointments.familyMemberId,
  startUtc: t.appointments.startUtc,
  endUtc: t.appointments.endUtc,
  durationMinutes: t.appointments.durationMinutes,
  status: t.appointments.status,
  type: t.appointments.type,
  reason: t.appointments.reason,
  feeAmount: t.appointments.feeAmount,
  currency: t.appointments.currency,
  rescheduleCount: t.appointments.rescheduleCount,
  createdAt: t.appointments.createdAt,
} as const;

/** Live intervals for a doctor in a range — what the engine subtracts. */
export async function bookedIntervals(
  doctorId: string,
  from: Date,
  to: Date,
  db: Database = getDb(),
): Promise<Interval[]> {
  const rows = await db
    .select({ start: t.appointments.startUtc, end: t.appointments.endUtc })
    .from(t.appointments)
    .where(
      and(
        eq(t.appointments.doctorId, doctorId),
        inArray(t.appointments.status, [...LIVE_STATUSES]),
        lt(t.appointments.startUtc, to),
        gte(t.appointments.endUtc, from),
      ),
    );
  return rows.map((r) => ({ start: r.start, end: r.end }));
}

/** The same, for a patient — so we can warn before the constraint fires. */
export async function patientIntervals(
  patientId: string,
  from: Date,
  to: Date,
  db: Database = getDb(),
): Promise<Interval[]> {
  const rows = await db
    .select({ start: t.appointments.startUtc, end: t.appointments.endUtc })
    .from(t.appointments)
    .where(
      and(
        eq(t.appointments.patientId, patientId),
        inArray(t.appointments.status, [...LIVE_STATUSES]),
        lt(t.appointments.startUtc, to),
        gte(t.appointments.endUtc, from),
      ),
    );
  return rows.map((r) => ({ start: r.start, end: r.end }));
}

export async function findById(
  id: string,
  db: Database = getDb(),
): Promise<AppointmentRow | null> {
  const rows = await db.select(columns).from(t.appointments).where(eq(t.appointments.id, id)).limit(1);
  return (rows[0] as AppointmentRow | undefined) ?? null;
}

export interface ListFilter {
  patientId?: string;
  doctorId?: string;
}

export interface HydratedAppointment extends Omit<AppointmentRow, "startUtc" | "endUtc" | "createdAt"> {
  startUtc: string;
  endUtc: string;
  createdAt: string;
  doctor: {
    id: string;
    name: string;
    initials: string;
    avatar: string;
    specialty: string | null;
    facility: string | null;
    fee: number;
    isDemoProfile: boolean;
  } | null;
  patientName: string | null;
}

/**
 * List appointments for exactly one subject. Requires a patient or a doctor —
 * there is no "list everything" call, so a caller cannot forget to scope.
 */
export async function list(
  filter: ListFilter,
  db: Database = getDb(),
): Promise<HydratedAppointment[]> {
  if (!filter.patientId && !filter.doctorId) {
    throw new Error("appointments.list requires a patientId or a doctorId");
  }

  const conditions = [];
  if (filter.patientId) conditions.push(eq(t.appointments.patientId, filter.patientId));
  if (filter.doctorId) conditions.push(eq(t.appointments.doctorId, filter.doctorId));

  const rows = await db
    .select({
      ...columns,
      doctorName: t.doctors.displayName,
      doctorInitials: t.doctors.initials,
      doctorAvatar: t.doctors.avatar,
      doctorFee: t.doctors.feeAmount,
      doctorIsDemo: t.doctors.isDemoProfile,
      specialty: t.specialties.name,
      facility: t.facilities.name,
      patientName: t.patients.displayName,
    })
    .from(t.appointments)
    .leftJoin(t.doctors, eq(t.appointments.doctorId, t.doctors.id))
    .leftJoin(t.specialties, eq(t.doctors.primarySpecialtyId, t.specialties.id))
    .leftJoin(t.facilities, eq(t.doctors.facilityId, t.facilities.id))
    .leftJoin(t.patients, eq(t.appointments.patientId, t.patients.id))
    .where(and(...conditions))
    .orderBy(asc(t.appointments.startUtc));

  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    doctorId: r.doctorId,
    patientId: r.patientId,
    bookedByUserId: r.bookedByUserId,
    familyMemberId: r.familyMemberId,
    startUtc: r.startUtc.toISOString(),
    endUtc: r.endUtc.toISOString(),
    durationMinutes: r.durationMinutes,
    status: r.status,
    type: r.type,
    reason: r.reason,
    feeAmount: r.feeAmount,
    currency: r.currency,
    rescheduleCount: r.rescheduleCount,
    createdAt: r.createdAt.toISOString(),
    doctor: r.doctorName
      ? {
          id: r.doctorId,
          name: r.doctorName,
          initials: r.doctorInitials ?? "",
          avatar: r.doctorAvatar ?? "teal",
          specialty: r.specialty,
          facility: r.facility,
          fee: Number(r.doctorFee ?? 0),
          isDemoProfile: Boolean(r.doctorIsDemo),
        }
      : null,
    patientName: r.patientName,
  }));
}

export interface InsertAppointment {
  reference: string;
  doctorId: string;
  patientId: string;
  bookedByUserId: string;
  familyMemberId?: string | null;
  startUtc: Date;
  endUtc: Date;
  durationMinutes: number;
  reason?: string | null;
  feeAmount: string;
  currency?: string;
}

/**
 * Book an appointment, serialised per doctor.
 *
 * The exclusion constraint alone is CORRECT but not LIVE under contention.
 * Several transactions inserting overlapping ranges each take a speculative
 * lock and then wait on one another, and PostgreSQL breaks the resulting cycle
 * by aborting one with 40P01. Under a real burst — a popular doctor's slots
 * opening at once — that deadlock is persistent rather than transient, and no
 * amount of retrying clears it: the concurrency suite reproduces it with twelve
 * simultaneous overlapping inserts, which still fail after four retries.
 *
 * A transaction-scoped advisory lock keyed on the doctor turns the many-way
 * lock cycle into a queue. Contenders for one doctor's calendar serialise;
 * different doctors never interact. The lock is released automatically on
 * commit or rollback, so a crashed request cannot wedge a calendar.
 *
 * The constraint is still what GUARANTEES correctness — the lock only removes
 * the deadlock. If this lock were ever dropped, bookings would still be correct,
 * just failure-prone under load. That ordering matters: liveness is layered on
 * top of safety, never in place of it.
 */
export async function insert(
  input: InsertAppointment,
  db: Database = getDb(),
): Promise<AppointmentRow> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`niramoy:doctor:${input.doctorId}`}))`,
    );
    return insertRow(input, tx as unknown as Database);
  });
}

async function insertRow(
  input: InsertAppointment,
  db: Database,
): Promise<AppointmentRow> {
  const rows = await db
    .insert(t.appointments)
    .values({
      reference: input.reference,
      doctorId: input.doctorId,
      patientId: input.patientId,
      bookedByUserId: input.bookedByUserId,
      familyMemberId: input.familyMemberId ?? null,
      startUtc: input.startUtc,
      endUtc: input.endUtc,
      durationMinutes: input.durationMinutes,
      status: "confirmed",
      type: "video",
      reason: input.reason ?? null,
      feeAmount: input.feeAmount,
      currency: input.currency ?? "BDT",
    })
    .returning(columns);
  return rows[0] as AppointmentRow;
}

export async function recordStatusChange(
  input: {
    appointmentId: string;
    fromStatus: string | null;
    toStatus: string;
    changedByUserId?: string | null;
    reasonCode?: string;
  },
  db: Database = getDb(),
): Promise<void> {
  await db.insert(t.appointmentStatusHistory).values({
    appointmentId: input.appointmentId,
    fromStatus: input.fromStatus as never,
    toStatus: input.toStatus as never,
    changedByUserId: input.changedByUserId ?? null,
    reasonCode: input.reasonCode ?? null,
  });
}

/**
 * Cancel, conditionally.
 *
 * The status filter is part of the WHERE, so two concurrent cancellations
 * cannot both succeed and the second gets zero rows rather than overwriting the
 * first's timestamp.
 */
export async function cancel(
  id: string,
  input: { byUserId: string; reason?: string | null },
  db: Database = getDb(),
): Promise<AppointmentRow | null> {
  const rows = await db
    .update(t.appointments)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledByUserId: input.byUserId,
      cancelReason: input.reason ?? null,
    })
    .where(and(eq(t.appointments.id, id), inArray(t.appointments.status, ["pending", "confirmed"])))
    .returning(columns);
  return (rows[0] as AppointmentRow | undefined) ?? null;
}

/**
 * Move an appointment to a new interval.
 *
 * An UPDATE, not a cancel-and-recreate. The prototype cancelled the old row and
 * inserted a new one, which detached the history and any linked prescription,
 * and left the patient with nothing at all if the insert failed after the
 * cancel. Moving the row keeps its identity and lets the exclusion constraint
 * adjudicate the new interval in the same statement.
 */
export async function move(
  id: string,
  input: { doctorId: string; startUtc: Date; endUtc: Date; durationMinutes: number },
  db: Database = getDb(),
): Promise<AppointmentRow | null> {
  return db.transaction(async (tx) => {
    // Same per-doctor serialisation as insert(): a reschedule competes for the
    // target interval exactly as a new booking does.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`niramoy:doctor:${input.doctorId}`}))`,
    );
    const rows = await (tx as unknown as Database)
      .update(t.appointments)
      .set({
        startUtc: input.startUtc,
        endUtc: input.endUtc,
        durationMinutes: input.durationMinutes,
        rescheduledFromUtc: sql`${t.appointments.startUtc}`,
        rescheduleCount: sql`${t.appointments.rescheduleCount} + 1`,
      })
      .where(
        and(eq(t.appointments.id, id), inArray(t.appointments.status, ["pending", "confirmed"])),
      )
      .returning(columns);
    return (rows[0] as AppointmentRow | undefined) ?? null;
  });
}

export async function complete(
  id: string,
  db: Database = getDb(),
): Promise<AppointmentRow | null> {
  const rows = await db
    .update(t.appointments)
    .set({ status: "completed", completedAt: new Date() })
    .where(
      and(eq(t.appointments.id, id), inArray(t.appointments.status, ["confirmed", "in_progress"])),
    )
    .returning(columns);
  return (rows[0] as AppointmentRow | undefined) ?? null;
}

/** Appointments whose time has passed without being completed or cancelled. */
export async function findNoShowCandidates(
  graceMinutes: number,
  db: Database = getDb(),
): Promise<AppointmentRow[]> {
  const rows = await db
    .select(columns)
    .from(t.appointments)
    .where(
      and(
        inArray(t.appointments.status, ["pending", "confirmed"]),
        lt(t.appointments.endUtc, sql`now() - make_interval(mins => ${graceMinutes})`),
      ),
    )
    .limit(500);
  return rows as AppointmentRow[];
}

export async function markNoShow(id: string, db: Database = getDb()): Promise<boolean> {
  const rows = await db
    .update(t.appointments)
    .set({ status: "no_show" })
    .where(and(eq(t.appointments.id, id), inArray(t.appointments.status, ["pending", "confirmed"])))
    .returning({ id: t.appointments.id });
  return rows.length > 0;
}

/** Upcoming appointments in a window, for the reminder job. */
export async function findForReminder(
  from: Date,
  to: Date,
  db: Database = getDb(),
): Promise<
  Array<{
    id: string;
    startUtc: Date;
    patientUserId: string | null;
    patientName: string;
    patientEmail: string | null;
    doctorName: string | null;
  }>
> {
  const rows = await db
    .select({
      id: t.appointments.id,
      startUtc: t.appointments.startUtc,
      patientUserId: t.patients.userId,
      patientName: t.patients.displayName,
      patientEmail: t.users.email,
      doctorName: t.doctors.displayName,
    })
    .from(t.appointments)
    .innerJoin(t.patients, eq(t.appointments.patientId, t.patients.id))
    .leftJoin(t.users, eq(t.patients.userId, t.users.id))
    .leftJoin(t.doctors, eq(t.appointments.doctorId, t.doctors.id))
    .where(
      and(
        eq(t.appointments.status, "confirmed"),
        gte(t.appointments.startUtc, from),
        lt(t.appointments.startUtc, to),
      ),
    )
    .limit(500);
  return rows;
}

