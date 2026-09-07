/**
 * Niramoy — doctor directory and reference data
 * -----------------------------------------------------------------------------
 * Geography, specialties and facilities are real structural data for Bangladesh
 * (8 divisions, 64 districts, real public hospitals, the DGHS specialty
 * taxonomy). The practitioners seeded on top of that backbone are synthetic and
 * are flagged `isDemoProfile`. See README.md and lib/data/*.
 */

import { sql } from "drizzle-orm";
import {
  boolean, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp,
  uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

import { users } from "./identity";
import { documentKind, verificationMethod, verificationStatus } from "./enums";

/* -------------------------------------------------------------------------- */
/* Reference data                                                              */
/* -------------------------------------------------------------------------- */

export const divisions = pgTable("divisions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nameBn: text("name_bn"),
  sortOrder: smallint("sort_order").notNull().default(0),
});

export const districts = pgTable(
  "districts",
  {
    id: text("id").primaryKey(),
    divisionId: text("division_id")
      .notNull()
      .references(() => divisions.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    nameBn: text("name_bn"),
  },
  (t) => [index("idx_districts_division").on(t.divisionId)],
);

export const specialties = pgTable(
  "specialties",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    nameBn: text("name_bn"),
    icon: text("icon"),
    blurb: text("blurb"),
    /** The raw DGHS labels this entry normalises. See db/reference/. */
    dghsLabels: jsonb("dghs_labels").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    sortOrder: smallint("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("uq_specialties_name").on(t.name)],
);

export const facilities = pgTable(
  "facilities",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind"),
    divisionId: text("division_id").references(() => divisions.id, { onDelete: "set null" }),
    districtId: text("district_id").references(() => districts.id, { onDelete: "set null" }),
  },
  (t) => [index("idx_facilities_district").on(t.districtId)],
);

/* -------------------------------------------------------------------------- */
/* Doctors                                                                     */
/* -------------------------------------------------------------------------- */

export const doctors = pgTable(
  "doctors",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Null only for seeded synthetic profiles, which have no account. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),

    displayName: text("display_name").notNull(),
    initials: text("initials").notNull(),
    avatar: text("avatar").notNull().default("teal"),
    slug: text("slug").notNull(),

    primarySpecialtyId: text("primary_specialty_id")
      .notNull()
      .references(() => specialties.id, { onDelete: "restrict" }),
    degrees: text("degrees").notNull().default(""),
    bio: text("bio").notNull().default(""),
    experienceYears: smallint("experience_years").notNull().default(0),
    languages: jsonb("languages").$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    facilityId: text("facility_id").references(() => facilities.id, { onDelete: "set null" }),
    districtId: text("district_id").references(() => districts.id, { onDelete: "set null" }),
    divisionId: text("division_id").references(() => divisions.id, { onDelete: "set null" }),

    feeAmount: numeric("fee_amount", { precision: 10, scale: 2 }).notNull().default("0"),
    currency: text("currency").notNull().default("BDT"),

    consultationMinutes: smallint("consultation_minutes").notNull().default(20),
    bufferMinutes: smallint("buffer_minutes").notNull().default(0),
    /** Minimum notice before a slot may be booked. */
    leadMinutes: integer("lead_minutes").notNull().default(60),
    cancelWindowMinutes: integer("cancel_window_minutes").notNull().default(60),

    acceptsVideo: boolean("accepts_video").notNull().default(true),
    acceptsFollowUp: boolean("accepts_follow_up").notNull().default(true),

    /**
     * PRIVATE. The registration number is never included in a public payload —
     * see lib/repositories/doctors.ts, which selects columns explicitly rather
     * than returning the row.
     */
    bmdcNumber: text("bmdc_number"),
    registrationType: text("registration_type"),

    verificationStatus: verificationStatus("verification_status").notNull().default("unsubmitted"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** Registration validity, when the register states one. Drives `expired`. */
    registrationValidUntil: timestamp("registration_valid_until", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspensionReason: text("suspension_reason"),

    /**
     * A synthetic profile built on real structural data. Rendered with a
     * "Demo profile" badge everywhere, and refused entirely when
     * ALLOW_DEMO_PROFILES is false (production default).
     */
    isDemoProfile: boolean("is_demo_profile").notNull().default(false),
    provenance: text("provenance").notNull().default("synthetic_seed"),

    /** Maintained from `reviews`; never written by a client. */
    ratingAvg: numeric("rating_avg", { precision: 3, scale: 2 }).notNull().default("0"),
    ratingCount: integer("rating_count").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_doctors_slug").on(t.slug),
    uniqueIndex("uq_doctors_user").on(t.userId),
    // One profile per registration number, across the whole platform.
    uniqueIndex("uq_doctors_bmdc").on(t.bmdcNumber),
    index("idx_doctors_specialty").on(t.primarySpecialtyId),
    index("idx_doctors_district").on(t.districtId),
    index("idx_doctors_division").on(t.divisionId),
    // The directory search only ever looks at bookable profiles.
    index("idx_doctors_bookable").on(t.verificationStatus, t.primarySpecialtyId, t.districtId),
  ],
);

/** Secondary specialties. The primary one stays denormalised on `doctors`. */
export const doctorSpecialties = pgTable(
  "doctor_specialties",
  {
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "cascade" }),
    specialtyId: text("specialty_id")
      .notNull()
      .references(() => specialties.id, { onDelete: "restrict" }),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [
    uniqueIndex("uq_doctor_specialty").on(t.doctorId, t.specialtyId),
    index("idx_doctor_specialties_specialty").on(t.specialtyId),
  ],
);

/** Where a doctor practises. A consultant commonly holds several chambers. */
export const doctorLocations = pgTable(
  "doctor_locations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "cascade" }),
    facilityId: text("facility_id").references(() => facilities.id, { onDelete: "set null" }),
    label: text("label"),
    districtId: text("district_id").references(() => districts.id, { onDelete: "set null" }),
    divisionId: text("division_id").references(() => divisions.id, { onDelete: "set null" }),
    addressLine: text("address_line"),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [index("idx_doctor_locations_doctor").on(t.doctorId)],
);

/* -------------------------------------------------------------------------- */
/* Verification                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One row per verification decision, never updated in place. The history of who
 * approved a doctor and on what evidence is exactly the record a regulator
 * would ask for, so it is append-oriented.
 */
export const doctorVerifications = pgTable(
  "doctor_verifications",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    doctorId: uuid("doctor_id").references(() => doctors.id, { onDelete: "cascade" }),
    /** The applying account. Null for applications filed before sign-in existed. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),

    /* What the applicant claimed. Kept verbatim — an admin compares it against
       the register, so it must not be silently normalised after submission. */
    registrationNumber: text("registration_number").notNull(),
    registrationType: text("registration_type").notNull(),
    claimedName: text("claimed_name").notNull(),
    claimedSpecialtyId: text("claimed_specialty_id").references(() => specialties.id),
    claimedDegrees: text("claimed_degrees"),
    claimedFacility: text("claimed_facility"),
    claimedDistrictId: text("claimed_district_id").references(() => districts.id),
    claimedDivisionId: text("claimed_division_id").references(() => divisions.id),
    claimedExperienceYears: smallint("claimed_experience_years"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),

    status: verificationStatus("status").notNull().default("pending"),
    method: verificationMethod("method"),

    /** The admin who made the decision. Required for a non-pending status. */
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** What the register said, per the admin or the API. */
    registerSaysName: text("register_says_name"),
    registerValidUntil: timestamp("register_valid_until", { withTimezone: true }),
    notes: text("notes"),

    /** Raw response from a configured BMDC_API_URL, for audit. Null when manual. */
    lookupPayload: jsonb("lookup_payload"),
    lookupSource: text("lookup_source"),

    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_verifications_status").on(t.status, t.submittedAt),
    index("idx_verifications_doctor").on(t.doctorId),
    index("idx_verifications_reg").on(t.registrationNumber),
  ],
);

/**
 * Supporting documents. Only the private object-storage key is stored — never a
 * public URL, and never the file itself (brief §46).
 */
export const doctorDocuments = pgTable(
  "doctor_documents",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    verificationId: uuid("verification_id")
      .notNull()
      .references(() => doctorVerifications.id, { onDelete: "cascade" }),
    kind: documentKind("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksumSha256: text("checksum_sha256"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [index("idx_doctor_documents_verification").on(t.verificationId)],
);

/**
 * Who an admin has cleared to register as a doctor.
 *
 * The gate in front of doctor sign-up. An admin checks a registration number
 * against the BM&DC register by hand — there is no bulk feed to check it
 * against — and records it here with the mobile number that doctor will sign
 * up on. Sign-up matches both, and spends the row.
 *
 * This is the evidence behind a verified profile, so rows are spent rather
 * than deleted: `claimedByUserId` ties an approval to the account it produced.
 */
export const doctorApprovals = pgTable(
  "doctor_approvals",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

    /** Normalised, so the sign-up lookup cannot miss on spacing or case. */
    registrationNumber: text("registration_number").notNull(),
    registrationType: text("registration_type").notNull(),
    /** E.164 — the shape sign-up proves by SMS. */
    phone: text("phone").notNull(),

    /** What the register said. The admin's own note, never shown to the applicant. */
    registerName: text("register_name"),
    note: text("note"),

    /** open → claimed once used, or revoked if the admin withdraws it. */
    status: text("status").notNull().default("open"),

    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    claimedByUserId: uuid("claimed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),

    revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_doctor_approvals_open_number")
      .on(t.registrationNumber)
      .where(sql`status = 'open'`),
    index("idx_doctor_approvals_lookup").on(t.registrationNumber, t.phone),
  ],
);
