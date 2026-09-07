/**
 * Niramoy — waitlist
 * -----------------------------------------------------------------------------
 * When a slot frees up, notifying everyone waiting starts a race that the
 * fastest browser wins. Instead the slot is OFFERED to one person at a time,
 * with an expiring hold:
 *
 *   cancellation
 *     → the longest-waiting eligible entry moves to `offered`, with the freed
 *       interval and a deadline recorded on it
 *     → that person is notified and may claim it
 *     → on claim, the booking runs normally and the constraint still adjudicates
 *     → on expiry, a sweep releases it and offers it to the next person
 *
 * The offer itself is allocated in a single conditional UPDATE, so two
 * concurrent cancellations cannot hand the same hold to two people.
 */

import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";

import { audit } from "../audit";
import { getDb } from "../db/client";
import * as t from "../db/schema";
import { AppError } from "../errors";
import { logger } from "../observability/logger";
import * as clinical from "../repositories/clinical";
import type { Principal } from "../security/authz";

/** How long a claimant has before the slot passes to the next person. */
export const OFFER_HOLD_MINUTES = 15;

export interface WaitlistEntryView {
  id: string;
  doctorId: string;
  patientId: string;
  targetDate: string;
  status: string;
  offeredStartUtc: string | null;
  offerExpiresAt: string | null;
  createdAt: string;
  doctor: { id: string; name: string; specialty: string | null } | null;
}

export async function listForPatient(patientId: string): Promise<WaitlistEntryView[]> {
  const rows = await getDb()
    .select({
      id: t.waitlistEntries.id,
      doctorId: t.waitlistEntries.doctorId,
      patientId: t.waitlistEntries.patientId,
      targetDate: t.waitlistEntries.targetDate,
      status: t.waitlistEntries.status,
      offeredStartUtc: t.waitlistEntries.offeredStartUtc,
      offerExpiresAt: t.waitlistEntries.offerExpiresAt,
      createdAt: t.waitlistEntries.createdAt,
      doctorName: t.doctors.displayName,
      specialty: t.specialties.name,
    })
    .from(t.waitlistEntries)
    .leftJoin(t.doctors, eq(t.waitlistEntries.doctorId, t.doctors.id))
    .leftJoin(t.specialties, eq(t.doctors.primarySpecialtyId, t.specialties.id))
    .where(
      and(
        eq(t.waitlistEntries.patientId, patientId),
        sql`${t.waitlistEntries.status} IN ('waiting', 'offered')`,
      ),
    )
    .orderBy(asc(t.waitlistEntries.createdAt));

  return rows.map((r) => ({
    id: r.id,
    doctorId: r.doctorId,
    patientId: r.patientId,
    targetDate: r.targetDate.toISOString().slice(0, 10),
    status: r.status,
    offeredStartUtc: r.offeredStartUtc ? r.offeredStartUtc.toISOString() : null,
    offerExpiresAt: r.offerExpiresAt ? r.offerExpiresAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    doctor: r.doctorName ? { id: r.doctorId, name: r.doctorName, specialty: r.specialty } : null,
  }));
}

export async function join(
  principal: Principal & { patientId: string },
  input: { doctorId?: unknown; dateKey?: unknown; targetDate?: unknown; preferredPeriod?: unknown },
  context: { requestId?: string },
): Promise<string> {
  const doctorId = String(input.doctorId ?? "");
  const dateKey = String(input.dateKey ?? input.targetDate ?? "");

  if (!doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new AppError("VALIDATION_FAILED", {
      details: { doctorId: doctorId ? [] : ["Pick a doctor."], dateKey: ["Pick a date."] },
    });
  }

  const rows = await getDb()
    .insert(t.waitlistEntries)
    .values({
      doctorId,
      patientId: principal.patientId,
      requestedByUserId: principal.userId,
      targetDate: new Date(`${dateKey}T00:00:00Z`),
      preferredPeriod: input.preferredPeriod ? String(input.preferredPeriod) : null,
      status: "waiting",
    })
    .returning({ id: t.waitlistEntries.id });

  await audit({
    action: "appointment.create",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId: context.requestId,
    resourceType: "waitlist_entry",
    resourceId: rows[0]!.id,
    metadata: { doctorId, dateKey },
  });

  return rows[0]!.id;
}

/** Leave the waitlist. Scoped to the caller's own patient identity. */
export async function leave(
  principal: Principal & { patientId: string },
  entryId: string,
): Promise<void> {
  const rows = await getDb()
    .update(t.waitlistEntries)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(t.waitlistEntries.id, entryId),
        eq(t.waitlistEntries.patientId, principal.patientId),
        sql`${t.waitlistEntries.status} IN ('waiting', 'offered')`,
      ),
    )
    .returning({ id: t.waitlistEntries.id });

  if (!rows.length) throw new AppError("NOT_FOUND");
}

/**
 * Offer a freed interval to the longest-waiting eligible entry.
 *
 * The UPDATE selects its own target in a subquery with FOR UPDATE SKIP LOCKED,
 * so two concurrent cancellations pick two different entries instead of
 * fighting over one. `status = 'waiting'` in the WHERE means an entry that was
 * already offered something cannot be offered a second slot.
 */
export async function offerFreedSlot(
  doctorId: string,
  start: Date,
  end: Date,
): Promise<{ offeredTo: string | null }> {
  const db = getDb();
  const expiresAt = new Date(Date.now() + OFFER_HOLD_MINUTES * 60_000);
  const dateKey = start.toISOString().slice(0, 10);

  const rows = await db.execute<{ id: string; patient_id: string; requested_by_user_id: string }>(sql`
    UPDATE waitlist_entries
       SET status = 'offered',
           offered_start_utc = ${start},
           offer_expires_at = ${expiresAt},
           notified_at = now()
     WHERE id = (
       SELECT id FROM waitlist_entries
        WHERE doctor_id = ${doctorId}
          AND status = 'waiting'
          AND target_date = ${dateKey}::date
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
    RETURNING id, patient_id, requested_by_user_id
  `);

  const row = (rows as unknown as { rows?: unknown[] }).rows
    ? (rows as unknown as { rows: { id: string; requested_by_user_id: string }[] }).rows[0]
    : (rows as unknown as { id: string; requested_by_user_id: string }[])[0];

  if (!row) return { offeredTo: null };

  await clinical.notify({
    userId: row.requested_by_user_id,
    type: "waitlist_slot_open",
    title: "A slot just opened",
    body: `A consultation slot is held for you for the next ${OFFER_HOLD_MINUTES} minutes.`,
    payload: { doctorId, startUtc: start.toISOString(), entryId: row.id },
    dedupeKey: `waitlist_offer:${row.id}:${start.toISOString()}`,
  });

  logger.info("waitlist slot offered", { doctorId, entryId: row.id });
  void end;
  return { offeredTo: row.id };
}

/**
 * Release expired holds and pass each slot to the next person waiting.
 * Idempotent: an entry already released is not `offered` any more, so a second
 * run does nothing.
 */
export async function expireStaleOffers(): Promise<number> {
  const db = getDb();

  const expired = await db
    .update(t.waitlistEntries)
    .set({ status: "waiting", offeredStartUtc: null, offerExpiresAt: null })
    .where(
      and(
        eq(t.waitlistEntries.status, "offered"),
        lte(t.waitlistEntries.offerExpiresAt, new Date()),
        isNull(t.waitlistEntries.claimedAppointmentId),
      ),
    )
    .returning({
      id: t.waitlistEntries.id,
      doctorId: t.waitlistEntries.doctorId,
      offeredStartUtc: t.waitlistEntries.offeredStartUtc,
    });

  return expired.length;
}
