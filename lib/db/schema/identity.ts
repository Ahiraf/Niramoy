/**
 * Niramoy — identity tables
 * -----------------------------------------------------------------------------
 * Identity data is deliberately separated from clinical data (brief §47).
 * `users` holds who you are and how you sign in; `patients` holds the clinical
 * identity that medical records hang off. A user can be deactivated without
 * destroying the clinical record that must be retained (brief §30).
 */

import { sql } from "drizzle-orm";
import {
  boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

import { tokenPurpose, userRole, userStatus } from "./enums";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    role: userRole("role").notNull().default("patient"),
    status: userStatus("status").notNull().default("active"),

    name: text("name").notNull(),
    /** Stored already lower-cased and trimmed; uniqueness is enforced on it. */
    email: text("email").notNull(),
    phone: text("phone"),

    /**
     * Where this person wants to be told about their care.
     *
     * `in_app` is not in here and cannot be switched off: the notification row
     * IS the record that we told them, and the platform needs that record to
     * exist whether or not they read it. These are the ADDITIONAL channels a
     * copy goes out on.
     *
     * A channel with no provider configured is stored but not delivered — see
     * lib/repositories/clinical.ts. Storing it anyway means the preference
     * survives until the provider exists, rather than being silently dropped.
     */
    notificationChannels: jsonb("notification_channels")
      .$type<string[]>()
      .notNull()
      .default(sql`'["email"]'::jsonb`),

    /** Argon2id. The algorithm is recorded so legacy scrypt hashes can be
     *  verified and transparently upgraded on next successful login. */
    passwordHash: text("password_hash").notNull(),
    passwordAlgo: text("password_algo").notNull().default("argon2id"),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),

    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),

    /** Brute-force / credential-stuffing counters (brief §7). */
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_users_email").on(t.email),
    index("idx_users_role_status").on(t.role, t.status),
  ],
);

/**
 * The clinical identity. Created for every user with role='patient', and also
 * for dependents who have no login of their own (family_members.patient_id).
 */
export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Null for a dependent who does not have their own account. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),

    /** Short human-facing code shown in the UI. Not a database key. */
    patientCode: text("patient_code").notNull(),

    displayName: text("display_name").notNull(),
    dateOfBirth: timestamp("date_of_birth", { withTimezone: false, mode: "date" }),
    gender: text("gender"),
    bloodGroup: text("blood_group"),

    divisionId: text("division_id"),
    districtId: text("district_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_patients_code").on(t.patientCode),
    uniqueIndex("uq_patients_user").on(t.userId),
    index("idx_patients_district").on(t.districtId),
  ],
);

/**
 * Server-side sessions. Only a SHA-256 hash of the opaque token is stored, so a
 * database leak does not hand out live sessions. `rotatedFrom` records the
 * chain so a stolen pre-rotation token can be traced.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    tokenHash: text("token_hash").notNull(),
    /** Paired CSRF secret for the double-submit cookie check (brief §45). */
    csrfSecret: text("csrf_secret").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),

    rotatedFrom: uuid("rotated_from"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),

    /** Hashed, never raw — these are personal data on their own. */
    ipHash: text("ip_hash"),
    userAgentHash: text("user_agent_hash"),
  },
  (t) => [
    uniqueIndex("uq_sessions_token_hash").on(t.tokenHash),
    index("idx_sessions_user").on(t.userId),
    index("idx_sessions_expires").on(t.expiresAt),
  ],
);

/**
 * Single-use tokens for email verification and password reset. Only the hash is
 * stored. A row's existence must never be revealed to an unauthenticated caller
 * — see the enumeration-resistance requirement in brief §7.
 */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: tokenPurpose("purpose").notNull(),

    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),

    requestedIpHash: text("requested_ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_auth_tokens_hash").on(t.tokenHash),
    index("idx_auth_tokens_user_purpose").on(t.userId, t.purpose),
    index("idx_auth_tokens_expires").on(t.expiresAt),
  ],
);

/**
 * A household. The owner books on behalf of the members listed in
 * `family_members`, subject to the per-member access level recorded there —
 * being family is not by itself permission to read a medical record (brief §26).
 */
export const familyAccounts = pgTable(
  "family_accounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_family_accounts_owner").on(t.ownerUserId)],
);

export const familyMembers = pgTable(
  "family_members",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    familyAccountId: uuid("family_account_id")
      .notNull()
      .references(() => familyAccounts.id, { onDelete: "cascade" }),

    /** The dependent's clinical identity. Every member gets one. */
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "restrict" }),
    /** Set when the dependent later opens their own account. */
    memberUserId: uuid("member_user_id").references(() => users.id, { onDelete: "set null" }),

    name: text("name").notNull(),
    relation: text("relation").notNull(),
    dateOfBirth: timestamp("date_of_birth", { withTimezone: false, mode: "date" }),
    gender: text("gender"),

    /** What the owner may see. Defaults to the least that makes booking work. */
    accessLevel: text("access_level").notNull().default("appointments_only"),
    /** An adult dependent can grant and revoke the owner's access. */
    consentGrantedAt: timestamp("consent_granted_at", { withTimezone: true }),
    consentRevokedAt: timestamp("consent_revoked_at", { withTimezone: true }),

    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_family_members_account").on(t.familyAccountId),
    uniqueIndex("uq_family_members_patient").on(t.patientId),
  ],
);
