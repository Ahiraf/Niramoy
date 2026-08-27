/**
 * Server-side sessions.
 *
 * Only a hash of the token is stored, so the database never holds anything that
 * could be replayed as a session. Every lookup also confirms the owning user is
 * still active — a suspended account's existing sessions stop working
 * immediately rather than lingering until they expire.
 */
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { getDb, type Database } from "../db/client";
import * as t from "../db/schema";
import type { UserRole } from "./users";

export interface SessionRow {
  id: string;
  userId: string;
  csrfSecret: string;
  expiresAt: Date;
}

/** A session joined to its user — what every authenticated request needs. */
export interface SessionWithUser {
  sessionId: string;
  csrfSecret: string;
  expiresAt: Date;
  user: {
    id: string;
    role: UserRole;
    name: string;
    email: string;
    phone: string | null;
    status: "active" | "suspended" | "deactivated";
    emailVerifiedAt: Date | null;
  };
}

export async function createSession(
  input: {
    userId: string;
    tokenHash: string;
    csrfSecret: string;
    expiresAt: Date;
    ipHash?: string | null;
    userAgentHash?: string | null;
    rotatedFrom?: string | null;
  },
  db: Database = getDb(),
): Promise<SessionRow> {
  const rows = await db
    .insert(t.sessions)
    .values({
      userId: input.userId,
      tokenHash: input.tokenHash,
      csrfSecret: input.csrfSecret,
      expiresAt: input.expiresAt,
      ipHash: input.ipHash ?? null,
      userAgentHash: input.userAgentHash ?? null,
      rotatedFrom: input.rotatedFrom ?? null,
    })
    .returning({
      id: t.sessions.id,
      userId: t.sessions.userId,
      csrfSecret: t.sessions.csrfSecret,
      expiresAt: t.sessions.expiresAt,
    });
  return rows[0] as SessionRow;
}

/**
 * Resolve a session token. Returns null for anything not currently usable:
 * unknown, expired, revoked, or belonging to a non-active account.
 */
export async function findByTokenHash(
  tokenHash: string,
  db: Database = getDb(),
): Promise<SessionWithUser | null> {
  const rows = await db
    .select({
      sessionId: t.sessions.id,
      csrfSecret: t.sessions.csrfSecret,
      expiresAt: t.sessions.expiresAt,
      userId: t.users.id,
      role: t.users.role,
      name: t.users.name,
      email: t.users.email,
      phone: t.users.phone,
      status: t.users.status,
      emailVerifiedAt: t.users.emailVerifiedAt,
    })
    .from(t.sessions)
    .innerJoin(t.users, eq(t.sessions.userId, t.users.id))
    .where(
      and(
        eq(t.sessions.tokenHash, tokenHash),
        isNull(t.sessions.revokedAt),
        sql`${t.sessions.expiresAt} > now()`,
        eq(t.users.status, "active"),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    sessionId: row.sessionId,
    csrfSecret: row.csrfSecret,
    expiresAt: row.expiresAt,
    user: {
      id: row.userId,
      role: row.role as UserRole,
      name: row.name,
      email: row.email,
      phone: row.phone,
      status: row.status as "active" | "suspended" | "deactivated",
      emailVerifiedAt: row.emailVerifiedAt,
    },
  };
}

/** Cheap liveness touch. Not awaited on the request path. */
export async function touch(sessionId: string, db: Database = getDb()): Promise<void> {
  await db.update(t.sessions).set({ lastSeenAt: new Date() }).where(eq(t.sessions.id, sessionId));
}

export async function revoke(
  sessionId: string,
  reason: string,
  db: Database = getDb(),
): Promise<void> {
  await db
    .update(t.sessions)
    .set({ revokedAt: new Date(), revokeReason: reason })
    .where(and(eq(t.sessions.id, sessionId), isNull(t.sessions.revokedAt)));
}

export async function revokeByTokenHash(
  tokenHash: string,
  reason: string,
  db: Database = getDb(),
): Promise<void> {
  await db
    .update(t.sessions)
    .set({ revokedAt: new Date(), revokeReason: reason })
    .where(and(eq(t.sessions.tokenHash, tokenHash), isNull(t.sessions.revokedAt)));
}

/**
 * Revoke every session for a user. Called on password change and password
 * reset: whoever changed the password keeps the session they did it from, and
 * everyone else — including an attacker holding a stolen session — is out.
 */
export async function revokeAllForUser(
  userId: string,
  reason: string,
  options: { exceptSessionId?: string } = {},
  db: Database = getDb(),
): Promise<number> {
  const conditions = [eq(t.sessions.userId, userId), isNull(t.sessions.revokedAt)];
  if (options.exceptSessionId) {
    conditions.push(sql`${t.sessions.id} <> ${options.exceptSessionId}`);
  }
  const rows = await db
    .update(t.sessions)
    .set({ revokedAt: new Date(), revokeReason: reason })
    .where(and(...conditions))
    .returning({ id: t.sessions.id });
  return rows.length;
}

/** Housekeeping for the cron sweep. */
export async function deleteExpiredSessions(db: Database = getDb()): Promise<number> {
  const rows = await db
    .delete(t.sessions)
    .where(
      or(
        lt(t.sessions.expiresAt, new Date()),
        // Revoked sessions are kept briefly so the rotation chain stays
        // traceable during an investigation, then removed.
        sql`${t.sessions.revokedAt} < now() - interval '30 days'`,
      ),
    )
    .returning({ id: t.sessions.id });
  return rows.length;
}
