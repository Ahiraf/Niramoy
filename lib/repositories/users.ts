/**
 * Users, patients and the auth token tables.
 */
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";

import { getDb, type Database } from "../db/client";
import * as t from "../db/schema";
import type { PasswordAlgo } from "../auth/password";

export type UserRole = "patient" | "doctor" | "admin";

export interface UserRow {
  id: string;
  role: UserRole;
  status: "active" | "suspended" | "deactivated";
  name: string;
  email: string;
  phone: string | null;
  passwordHash: string;
  passwordAlgo: PasswordAlgo;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  /** Extra delivery channels; `in_app` is implicit and not listed. */
  notificationChannels: string[];
  failedLoginCount: number;
  lockedUntil: Date | null;
  createdAt: Date;
}

const userColumns = {
  id: t.users.id,
  role: t.users.role,
  status: t.users.status,
  name: t.users.name,
  email: t.users.email,
  phone: t.users.phone,
  passwordHash: t.users.passwordHash,
  passwordAlgo: t.users.passwordAlgo,
  emailVerifiedAt: t.users.emailVerifiedAt,
  phoneVerifiedAt: t.users.phoneVerifiedAt,
  notificationChannels: t.users.notificationChannels,
  failedLoginCount: t.users.failedLoginCount,
  lockedUntil: t.users.lockedUntil,
  createdAt: t.users.createdAt,
} as const;

export const normaliseEmail = (email: unknown): string =>
  String(email ?? "").trim().toLowerCase();

export async function findByEmail(email: string, db: Database = getDb()): Promise<UserRow | null> {
  const rows = await db
    .select(userColumns)
    .from(t.users)
    .where(eq(t.users.email, normaliseEmail(email)))
    .limit(1);
  return (rows[0] as UserRow | undefined) ?? null;
}

export async function findById(id: string, db: Database = getDb()): Promise<UserRow | null> {
  const rows = await db.select(userColumns).from(t.users).where(eq(t.users.id, id)).limit(1);
  return (rows[0] as UserRow | undefined) ?? null;
}

export interface CreateUserInput {
  role: UserRole;
  name: string;
  email: string;
  phone?: string | null;
  /** True only when a code was read back before the account was created. */
  phoneVerified?: boolean;
  passwordHash: string;
  passwordAlgo: PasswordAlgo;
}

export async function createUser(input: CreateUserInput, db: Database = getDb()): Promise<UserRow> {
  const rows = await db
    .insert(t.users)
    .values({
      role: input.role,
      name: input.name,
      email: normaliseEmail(input.email),
      phone: input.phone ?? null,
      phoneVerifiedAt: input.phoneVerified ? new Date() : null,
      passwordHash: input.passwordHash,
      passwordAlgo: input.passwordAlgo,
      passwordChangedAt: new Date(),
    })
    .returning(userColumns);
  return rows[0] as UserRow;
}

export async function updateProfile(
  userId: string,
  patch: { name?: string; phone?: string | null; notificationChannels?: string[] },
  db: Database = getDb(),
): Promise<UserRow | null> {
  const values: Record<string, unknown> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.phone !== undefined) {
    values.phone = patch.phone;
    /**
     * Changing the number un-verifies it, in the same statement that changes
     * it. Comparing here rather than in a read-then-write means there is no
     * window in which the row says "verified" about a number nobody proved,
     * and re-saving the same number does not make somebody verify it twice.
     */
    values.phoneVerifiedAt = sql`CASE WHEN ${t.users.phone} IS DISTINCT FROM ${patch.phone}
                                      THEN NULL ELSE ${t.users.phoneVerifiedAt} END`;
  }
  if (patch.notificationChannels !== undefined) {
    values.notificationChannels = patch.notificationChannels;
  }
  if (!Object.keys(values).length) return findById(userId, db);

  const rows = await db.update(t.users).set(values).where(eq(t.users.id, userId)).returning(userColumns);
  return (rows[0] as UserRow | undefined) ?? null;
}

export async function setPassword(
  userId: string,
  hash: string,
  algo: PasswordAlgo,
  db: Database = getDb(),
): Promise<void> {
  await db
    .update(t.users)
    .set({ passwordHash: hash, passwordAlgo: algo, passwordChangedAt: new Date() })
    .where(eq(t.users.id, userId));
}

export async function markEmailVerified(userId: string, db: Database = getDb()): Promise<void> {
  await db.update(t.users).set({ emailVerifiedAt: new Date() }).where(eq(t.users.id, userId));
}

/**
 * Record that the number on the account was proved.
 *
 * Conditional on the number still being the one that was verified: between
 * sending a code and reading it back, the same person may have edited their
 * profile in another tab, and the code proves nothing about the new number.
 */
export async function markPhoneVerified(
  userId: string,
  phone: string,
  db: Database = getDb(),
): Promise<boolean> {
  const rows = await db
    .update(t.users)
    .set({ phoneVerifiedAt: new Date() })
    .where(and(eq(t.users.id, userId), eq(t.users.phone, phone)))
    .returning({ id: t.users.id });
  return Boolean(rows[0]);
}

/* -------------------------------------------------------------------------- */
/* Failed-login tracking                                                       */
/* -------------------------------------------------------------------------- */

/** Lock after this many consecutive failures, for this long. */
export const MAX_FAILED_LOGINS = 8;
export const LOCKOUT_MINUTES = 15;

export async function recordFailedLogin(userId: string, db: Database = getDb()): Promise<void> {
  await db
    .update(t.users)
    .set({
      failedLoginCount: sql`${t.users.failedLoginCount} + 1`,
      // Lock once the threshold is crossed, computed in SQL so two concurrent
      // failures cannot both read the old count and skip the lock.
      lockedUntil: sql`CASE WHEN ${t.users.failedLoginCount} + 1 >= ${MAX_FAILED_LOGINS}
                            THEN now() + interval '${sql.raw(String(LOCKOUT_MINUTES))} minutes'
                            ELSE ${t.users.lockedUntil} END`,
    })
    .where(eq(t.users.id, userId));
}

export async function recordSuccessfulLogin(userId: string, db: Database = getDb()): Promise<void> {
  await db
    .update(t.users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(t.users.id, userId));
}

export const isLocked = (user: UserRow): boolean =>
  Boolean(user.lockedUntil && user.lockedUntil.getTime() > Date.now());

/* -------------------------------------------------------------------------- */
/* Patients                                                                    */
/* -------------------------------------------------------------------------- */

export interface PatientRow {
  id: string;
  userId: string | null;
  patientCode: string;
  displayName: string;
  divisionId: string | null;
  districtId: string | null;
}

const patientColumns = {
  id: t.patients.id,
  userId: t.patients.userId,
  patientCode: t.patients.patientCode,
  displayName: t.patients.displayName,
  divisionId: t.patients.divisionId,
  districtId: t.patients.districtId,
} as const;

export async function findPatientByUserId(
  userId: string,
  db: Database = getDb(),
): Promise<PatientRow | null> {
  const rows = await db
    .select(patientColumns)
    .from(t.patients)
    .where(eq(t.patients.userId, userId))
    .limit(1);
  return (rows[0] as PatientRow | undefined) ?? null;
}

export async function findPatientById(
  id: string,
  db: Database = getDb(),
): Promise<PatientRow | null> {
  const rows = await db.select(patientColumns).from(t.patients).where(eq(t.patients.id, id)).limit(1);
  return (rows[0] as PatientRow | undefined) ?? null;
}

/** A short, non-sequential display code. Not a key; collisions just retry. */
function patientCode(): string {
  const n = Math.floor(Math.random() * 900_000) + 100_000;
  return `NRM-${n}`;
}

export async function createPatient(
  input: { userId: string | null; displayName: string; divisionId?: string | null; districtId?: string | null },
  db: Database = getDb(),
): Promise<PatientRow> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rows = await db
      .insert(t.patients)
      .values({
        userId: input.userId,
        patientCode: patientCode(),
        displayName: input.displayName,
        divisionId: input.divisionId ?? null,
        districtId: input.districtId ?? null,
      })
      .onConflictDoNothing({ target: t.patients.patientCode })
      .returning(patientColumns);
    if (rows[0]) return rows[0] as PatientRow;
  }
  throw new Error("could not allocate a unique patient code");
}

export async function updatePatient(
  patientId: string,
  patch: { displayName?: string; divisionId?: string | null; districtId?: string | null },
  db: Database = getDb(),
): Promise<void> {
  const values: Record<string, unknown> = {};
  if (patch.displayName !== undefined) values.displayName = patch.displayName;
  if (patch.divisionId !== undefined) values.divisionId = patch.divisionId;
  if (patch.districtId !== undefined) values.districtId = patch.districtId;
  if (!Object.keys(values).length) return;
  await db.update(t.patients).set(values).where(eq(t.patients.id, patientId));
}

/* -------------------------------------------------------------------------- */
/* Auth tokens                                                                 */
/* -------------------------------------------------------------------------- */

export type TokenPurpose = "email_verification" | "password_reset" | "phone_verification";

export async function createAuthToken(
  input: { userId: string; purpose: TokenPurpose; tokenHash: string; expiresAt: Date; ipHash?: string | null },
  db: Database = getDb(),
): Promise<void> {
  await db.insert(t.authTokens).values({
    userId: input.userId,
    purpose: input.purpose,
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt,
    requestedIpHash: input.ipHash ?? null,
  });
}

export interface AuthTokenRow {
  id: string;
  userId: string;
  purpose: TokenPurpose;
  expiresAt: Date;
}

/**
 * Consume a token: find it, mark it used, and return it — but only if it is
 * unconsumed and unexpired. Single-statement so a token cannot be used twice by
 * two concurrent requests.
 */
export async function consumeAuthToken(
  tokenHash: string,
  purpose: TokenPurpose,
  db: Database = getDb(),
): Promise<AuthTokenRow | null> {
  const rows = await db
    .update(t.authTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(t.authTokens.tokenHash, tokenHash),
        eq(t.authTokens.purpose, purpose),
        isNull(t.authTokens.consumedAt),
        sql`${t.authTokens.expiresAt} > now()`,
      ),
    )
    .returning({
      id: t.authTokens.id,
      userId: t.authTokens.userId,
      purpose: t.authTokens.purpose,
      expiresAt: t.authTokens.expiresAt,
    });
  return (rows[0] as AuthTokenRow | undefined) ?? null;
}

export interface LiveTokenRow {
  id: string;
  tokenHash: string;
  attemptCount: number;
  expiresAt: Date;
}

/**
 * The newest unconsumed, unexpired token of a purpose for one user.
 *
 * Link tokens are looked up BY their hash — the token is the credential and the
 * account is whatever it points at. A six-digit code cannot work that way: the
 * codes are short enough to collide across accounts, so the account comes from
 * the session and the code is checked against it. That is also what lets the
 * wrong guesses be counted somewhere.
 */
export async function findLiveAuthToken(
  userId: string,
  purpose: TokenPurpose,
  db: Database = getDb(),
): Promise<LiveTokenRow | null> {
  const rows = await db
    .select({
      id: t.authTokens.id,
      tokenHash: t.authTokens.tokenHash,
      attemptCount: t.authTokens.attemptCount,
      expiresAt: t.authTokens.expiresAt,
    })
    .from(t.authTokens)
    .where(
      and(
        eq(t.authTokens.userId, userId),
        eq(t.authTokens.purpose, purpose),
        isNull(t.authTokens.consumedAt),
        sql`${t.authTokens.expiresAt} > now()`,
      ),
    )
    .orderBy(desc(t.authTokens.createdAt))
    .limit(1);
  return (rows[0] as LiveTokenRow | undefined) ?? null;
}

/**
 * Count a wrong guess, and burn the token once there have been too many.
 *
 * Both happen in one statement: an attacker firing concurrent guesses must not
 * be able to have several of them read the same count and each decide it is
 * still under the limit. Returns how many attempts have now been made.
 */
export async function recordTokenAttempt(
  tokenId: string,
  maxAttempts: number,
  db: Database = getDb(),
): Promise<number> {
  const rows = await db
    .update(t.authTokens)
    .set({
      attemptCount: sql`${t.authTokens.attemptCount} + 1`,
      consumedAt: sql`CASE WHEN ${t.authTokens.attemptCount} + 1 >= ${maxAttempts}
                           THEN now() ELSE ${t.authTokens.consumedAt} END`,
    })
    .where(eq(t.authTokens.id, tokenId))
    .returning({ attemptCount: t.authTokens.attemptCount });
  return Number(rows[0]?.attemptCount ?? maxAttempts);
}

/**
 * Spend a token found by id. Conditional on it still being unconsumed, so two
 * concurrent requests holding the same correct code cannot both succeed.
 */
export async function consumeAuthTokenById(
  tokenId: string,
  db: Database = getDb(),
): Promise<boolean> {
  const rows = await db
    .update(t.authTokens)
    .set({ consumedAt: new Date() })
    .where(and(eq(t.authTokens.id, tokenId), isNull(t.authTokens.consumedAt)))
    .returning({ id: t.authTokens.id });
  return Boolean(rows[0]);
}

/** Invalidate outstanding tokens of a purpose — e.g. after a password change. */
export async function revokeAuthTokens(
  userId: string,
  purpose: TokenPurpose,
  db: Database = getDb(),
): Promise<void> {
  await db
    .update(t.authTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(t.authTokens.userId, userId),
        eq(t.authTokens.purpose, purpose),
        isNull(t.authTokens.consumedAt),
      ),
    );
}

/** Housekeeping for the cron sweep. */
export async function deleteExpiredAuthTokens(db: Database = getDb()): Promise<number> {
  const rows = await db
    .delete(t.authTokens)
    .where(or(lt(t.authTokens.expiresAt, new Date()), sql`${t.authTokens.consumedAt} IS NOT NULL`))
    .returning({ id: t.authTokens.id });
  return rows.length;
}
