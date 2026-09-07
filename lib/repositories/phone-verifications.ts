/**
 * Codes sent to a number that has no account yet.
 *
 * Every query here is keyed on the phone number rather than on a user, because
 * at this point in sign-up there is no user. None of these functions may be
 * used to answer "does this number have an account?" — that question belongs to
 * the users table, and the answer is not something an unauthenticated caller
 * gets to learn.
 */
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";

import { getDb, type Database } from "../db/client";
import * as t from "../db/schema";

export interface PhoneVerificationRow {
  id: string;
  phone: string;
  codeHash: string;
  expiresAt: Date;
  attemptCount: number;
  verifiedAt: Date | null;
  ticketHash: string | null;
}

const columns = {
  id: t.phoneVerifications.id,
  phone: t.phoneVerifications.phone,
  codeHash: t.phoneVerifications.codeHash,
  expiresAt: t.phoneVerifications.expiresAt,
  attemptCount: t.phoneVerifications.attemptCount,
  verifiedAt: t.phoneVerifications.verifiedAt,
  ticketHash: t.phoneVerifications.ticketHash,
} as const;

export async function create(
  input: { phone: string; codeHash: string; expiresAt: Date; ipHash?: string | null },
  db: Database = getDb(),
): Promise<string> {
  const rows = await db
    .insert(t.phoneVerifications)
    .values({
      phone: input.phone,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt,
      requestedIpHash: input.ipHash ?? null,
    })
    .returning({ id: t.phoneVerifications.id });
  return rows[0]!.id;
}

/** The newest live, unverified code for a number. */
export async function findPendingCode(
  phone: string,
  db: Database = getDb(),
): Promise<PhoneVerificationRow | null> {
  const rows = await db
    .select(columns)
    .from(t.phoneVerifications)
    .where(
      and(
        eq(t.phoneVerifications.phone, phone),
        isNull(t.phoneVerifications.verifiedAt),
        isNull(t.phoneVerifications.consumedAt),
        sql`${t.phoneVerifications.expiresAt} > now()`,
      ),
    )
    .orderBy(desc(t.phoneVerifications.createdAt))
    .limit(1);
  return (rows[0] as PhoneVerificationRow | undefined) ?? null;
}

/**
 * Count a wrong guess and expire the code once there have been too many, in one
 * statement so concurrent guesses cannot each read the same count.
 *
 * The code is expired rather than deleted: the row still records that somebody
 * was guessing at this number, which is what the sweep and any later abuse
 * question want to see.
 */
export async function recordAttempt(
  id: string,
  maxAttempts: number,
  db: Database = getDb(),
): Promise<number> {
  const rows = await db
    .update(t.phoneVerifications)
    .set({
      attemptCount: sql`${t.phoneVerifications.attemptCount} + 1`,
      expiresAt: sql`CASE WHEN ${t.phoneVerifications.attemptCount} + 1 >= ${maxAttempts}
                          THEN now() ELSE ${t.phoneVerifications.expiresAt} END`,
    })
    .where(eq(t.phoneVerifications.id, id))
    .returning({ attemptCount: t.phoneVerifications.attemptCount });
  return Number(rows[0]?.attemptCount ?? maxAttempts);
}

/**
 * Mark a code as correct and attach the ticket registration will spend.
 *
 * Conditional on the row still being unverified, so two requests racing with
 * the same correct code cannot mint two tickets for one verification.
 */
export async function markVerified(
  id: string,
  ticketHash: string,
  db: Database = getDb(),
): Promise<boolean> {
  const rows = await db
    .update(t.phoneVerifications)
    .set({ verifiedAt: new Date(), ticketHash })
    .where(and(eq(t.phoneVerifications.id, id), isNull(t.phoneVerifications.verifiedAt)))
    .returning({ id: t.phoneVerifications.id });
  return Boolean(rows[0]);
}

/**
 * Spend a ticket.
 *
 * Matches on the phone AND the ticket hash together: a ticket is only good for
 * the number it was issued against, so one cannot be replayed to claim
 * a different number. Single statement, so two sign-ups racing on one ticket
 * cannot both succeed.
 */
export async function consumeTicket(
  phone: string,
  ticketHash: string,
  ticketTtlMinutes: number,
  db: Database = getDb(),
): Promise<boolean> {
  const rows = await db
    .update(t.phoneVerifications)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(t.phoneVerifications.phone, phone),
        eq(t.phoneVerifications.ticketHash, ticketHash),
        isNull(t.phoneVerifications.consumedAt),
        sql`${t.phoneVerifications.verifiedAt} > now() - make_interval(mins => ${ticketTtlMinutes})`,
      ),
    )
    .returning({ id: t.phoneVerifications.id });
  return Boolean(rows[0]);
}

/** Housekeeping for the cron sweep: expired and never verified. */
export async function deleteExpired(db: Database = getDb()): Promise<number> {
  const rows = await db
    .delete(t.phoneVerifications)
    .where(lt(t.phoneVerifications.expiresAt, new Date(Date.now() - 86_400_000)))
    .returning({ id: t.phoneVerifications.id });
  return rows.length;
}
