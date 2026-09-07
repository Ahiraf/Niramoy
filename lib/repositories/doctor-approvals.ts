/**
 * Niramoy — admin pre-approval of doctor registrations
 *
 * An admin confirms a registration number against the BM&DC register by hand
 * (there is no bulk feed to check it against) and records it here with the
 * mobile number that doctor will sign up on. Doctor sign-up matches both and
 * spends the row.
 *
 * Everything here takes an already-normalised number and an E.164 phone. The
 * normalising lives at the edges — the admin route and the sign-up service —
 * so the two can never disagree about what "the same number" means.
 */

import { and, desc, eq } from "drizzle-orm";

import { getDb, type Database } from "../db/client";
import * as t from "../db/schema";

export interface DoctorApprovalRow {
  id: string;
  registrationNumber: string;
  registrationType: string;
  phone: string;
  registerName: string | null;
  note: string | null;
  status: string;
  createdAt: Date;
  claimedAt: Date | null;
  claimedByUserId: string | null;
}

const columns = {
  id: t.doctorApprovals.id,
  registrationNumber: t.doctorApprovals.registrationNumber,
  registrationType: t.doctorApprovals.registrationType,
  phone: t.doctorApprovals.phone,
  registerName: t.doctorApprovals.registerName,
  note: t.doctorApprovals.note,
  status: t.doctorApprovals.status,
  createdAt: t.doctorApprovals.createdAt,
  claimedAt: t.doctorApprovals.claimedAt,
  claimedByUserId: t.doctorApprovals.claimedByUserId,
} as const;

export async function listApprovals(db: Database = getDb()): Promise<DoctorApprovalRow[]> {
  return db
    .select(columns)
    .from(t.doctorApprovals)
    .orderBy(desc(t.doctorApprovals.createdAt))
    .limit(200);
}

export async function createApproval(
  input: {
    registrationNumber: string;
    registrationType: string;
    phone: string;
    registerName?: string | null;
    note?: string | null;
    createdByUserId: string;
  },
  db: Database = getDb(),
): Promise<DoctorApprovalRow> {
  const rows = await db
    .insert(t.doctorApprovals)
    .values({
      registrationNumber: input.registrationNumber,
      registrationType: input.registrationType,
      phone: input.phone,
      registerName: input.registerName ?? null,
      note: input.note ?? null,
      createdByUserId: input.createdByUserId,
    })
    .returning(columns);

  return rows[0]!;
}

/**
 * Spend an approval for this number and phone.
 *
 * Conditional on the row still being open, and returning it only if the update
 * actually hit something, so two sign-ups racing on one approval cannot both
 * win. The phone is part of the WHERE rather than checked afterwards: a lookup
 * that matched on the number alone and compared the phone in application code
 * would be a different query under concurrency, and a wrong one.
 */
export async function claimApproval(
  input: { registrationNumber: string; phone: string; userId: string },
  db: Database = getDb(),
): Promise<DoctorApprovalRow | null> {
  const rows = await db
    .update(t.doctorApprovals)
    .set({
      status: "claimed",
      claimedByUserId: input.userId,
      claimedAt: new Date(),
    })
    .where(
      and(
        eq(t.doctorApprovals.registrationNumber, input.registrationNumber),
        eq(t.doctorApprovals.phone, input.phone),
        eq(t.doctorApprovals.status, "open"),
      ),
    )
    .returning(columns);

  return rows[0] ?? null;
}

/**
 * The approval an account was created from, if any.
 *
 * Read when a doctor files their profile, to decide whether the registration
 * number has already been checked by a person or still needs to be.
 */
export async function approvalClaimedBy(
  userId: string,
  db: Database = getDb(),
): Promise<DoctorApprovalRow | null> {
  const rows = await db
    .select(columns)
    .from(t.doctorApprovals)
    .where(
      and(
        eq(t.doctorApprovals.claimedByUserId, userId),
        eq(t.doctorApprovals.status, "claimed"),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** Withdraw an approval that has not been used yet. */
export async function revokeApproval(
  input: { id: string; adminUserId: string },
  db: Database = getDb(),
): Promise<DoctorApprovalRow | null> {
  const rows = await db
    .update(t.doctorApprovals)
    .set({
      status: "revoked",
      revokedByUserId: input.adminUserId,
      revokedAt: new Date(),
    })
    // Only an open row: a claimed approval has already produced an account,
    // and rewriting its status would erase how that account came to exist.
    .where(and(eq(t.doctorApprovals.id, input.id), eq(t.doctorApprovals.status, "open")))
    .returning(columns);

  return rows[0] ?? null;
}

/** Who approved this account, for the audit trail on the published profile. */
export async function approverOf(
  userId: string,
  db: Database = getDb(),
): Promise<string | null> {
  const rows = await db
    .select({ createdByUserId: t.doctorApprovals.createdByUserId })
    .from(t.doctorApprovals)
    .where(eq(t.doctorApprovals.claimedByUserId, userId))
    .limit(1);

  return rows[0]?.createdByUserId ?? null;
}
