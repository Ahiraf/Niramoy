/**
 * The doctor directory.
 *
 * Two rules govern everything in this file.
 *
 *   1. Only a VERIFIED, non-suspended profile is bookable and discoverable.
 *      There is no code path here that returns an unverified doctor to a
 *      patient-facing caller.
 *
 *   2. `bmdcNumber` is never selected into a public view. Every query lists its
 *      columns explicitly rather than returning the row, so a new private column
 *      cannot leak by being added to the table.
 */
import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import { getDb } from "../db/client";
import * as t from "../db/schema";

/**
 * The public shape of a doctor, matching what the existing frontend renders
 * (app/components/patient/find-doctors.js).
 */
export interface DoctorView {
  id: string;
  name: string;
  initials: string;
  avatar: string;
  slug: string;
  specialtyId: string;
  specialty: string;
  degrees: string;
  bio: string;
  facility: string | null;
  district: string | null;
  division: string | null;
  divisionId: string | null;
  experienceYears: number;
  fee: number;
  feeLabel: string;
  rating: number;
  ratingCount: number;
  languages: string[];
  consultationMinutes: number;
  acceptsVideo: boolean;
  acceptsFollowUp: boolean;
  verified: boolean;
  verifiedAt: string | null;
  isDemoProfile: boolean;
  provenance: string;
}

/** The public column list. `bmdcNumber` is deliberately absent. */
const publicColumns = {
  id: t.doctors.id,
  name: t.doctors.displayName,
  initials: t.doctors.initials,
  avatar: t.doctors.avatar,
  slug: t.doctors.slug,
  specialtyId: t.doctors.primarySpecialtyId,
  specialty: t.specialties.name,
  degrees: t.doctors.degrees,
  bio: t.doctors.bio,
  facility: t.facilities.name,
  district: t.districts.name,
  division: t.divisions.name,
  divisionId: t.doctors.divisionId,
  experienceYears: t.doctors.experienceYears,
  fee: t.doctors.feeAmount,
  rating: t.doctors.ratingAvg,
  ratingCount: t.doctors.ratingCount,
  languages: t.doctors.languages,
  consultationMinutes: t.doctors.consultationMinutes,
  acceptsVideo: t.doctors.acceptsVideo,
  acceptsFollowUp: t.doctors.acceptsFollowUp,
  verifiedAt: t.doctors.verifiedAt,
  isDemoProfile: t.doctors.isDemoProfile,
  provenance: t.doctors.provenance,
} as const;

type RawDoctor = {
  [K in keyof typeof publicColumns]: unknown;
};

const money = (value: unknown): number => Number(value ?? 0);

function toView(row: RawDoctor): DoctorView {
  const fee = money(row.fee);
  return {
    id: row.id as string,
    name: row.name as string,
    initials: row.initials as string,
    avatar: row.avatar as string,
    slug: row.slug as string,
    specialtyId: row.specialtyId as string,
    specialty: (row.specialty as string) ?? "",
    degrees: (row.degrees as string) ?? "",
    bio: (row.bio as string) ?? "",
    facility: (row.facility as string) ?? null,
    district: (row.district as string) ?? null,
    division: (row.division as string) ?? null,
    divisionId: (row.divisionId as string) ?? null,
    experienceYears: Number(row.experienceYears ?? 0),
    fee,
    feeLabel: `৳ ${fee.toLocaleString("en-BD")}`,
    rating: money(row.rating),
    ratingCount: Number(row.ratingCount ?? 0),
    languages: (row.languages as string[]) ?? [],
    consultationMinutes: Number(row.consultationMinutes ?? 20),
    acceptsVideo: Boolean(row.acceptsVideo),
    acceptsFollowUp: Boolean(row.acceptsFollowUp),
    // A doctor reaching this view is verified by construction; the flag is kept
    // because the existing UI reads it.
    verified: true,
    verifiedAt: row.verifiedAt ? (row.verifiedAt as Date).toISOString().slice(0, 10) : null,
    isDemoProfile: Boolean(row.isDemoProfile),
    provenance: (row.provenance as string) ?? "unknown",
  };
}

/** The only definition of "appears in the directory". */
const isBookable: SQL = and(
  eq(t.doctors.verificationStatus, "verified"),
  isNull(t.doctors.suspendedAt),
)!;

export interface DoctorSearch {
  search?: string;
  specialty?: string;
  division?: string;
  district?: string;
  language?: string;
  maxFee?: number | string;
  minRating?: number | string;
  sort?: "best" | "rating" | "fee_low" | "fee_high" | "experience";
  page?: number | string;
  perPage?: number | string;
}

export interface DoctorSearchResult {
  doctors: DoctorView[];
  total: number;
  page: number;
  perPage: number;
}

const MAX_PER_PAGE = 60;

export async function searchDoctors(params: DoctorSearch = {}): Promise<DoctorSearchResult> {
  const db = getDb();

  const filters: SQL[] = [isBookable];

  const term = params.search?.trim();
  if (term) {
    const like = `%${term}%`;
    const textMatch = or(
      ilike(t.doctors.displayName, like),
      ilike(t.doctors.degrees, like),
      ilike(t.specialties.name, like),
      ilike(t.facilities.name, like),
      ilike(t.districts.name, like),
    );
    if (textMatch) filters.push(textMatch);
  }

  if (params.specialty && params.specialty !== "All specialties") {
    filters.push(eq(t.specialties.name, params.specialty));
  }
  if (params.division && params.division !== "All divisions") {
    filters.push(eq(t.divisions.name, params.division));
  }
  if (params.district && params.district !== "All districts") {
    filters.push(eq(t.districts.name, params.district));
  }
  if (params.language && params.language !== "Any language") {
    // jsonb containment, so it uses the column rather than a string scan.
    filters.push(sql`${t.doctors.languages} @> ${JSON.stringify([params.language])}::jsonb`);
  }
  if (params.maxFee) filters.push(lte(t.doctors.feeAmount, String(Number(params.maxFee))));
  if (params.minRating) filters.push(gte(t.doctors.ratingAvg, String(Number(params.minRating))));

  const where = and(...filters);

  /**
   * "Best" balances rating against how many ratings there are, so a single
   * 5-star review does not outrank a consistently well-reviewed doctor. Same
   * formula the prototype used, moved into SQL.
   */
  const orderBy = {
    rating: [desc(t.doctors.ratingAvg), desc(t.doctors.ratingCount)],
    fee_low: [asc(t.doctors.feeAmount)],
    fee_high: [desc(t.doctors.feeAmount)],
    experience: [desc(t.doctors.experienceYears)],
    best: [desc(sql`${t.doctors.ratingAvg} * log(10, ${t.doctors.ratingCount} + 10)`)],
  }[params.sort ?? "best"] ?? [desc(t.doctors.ratingAvg)];

  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Number(params.perPage ?? 24) || 24));

  const base = db
    .select(publicColumns)
    .from(t.doctors)
    .innerJoin(t.specialties, eq(t.doctors.primarySpecialtyId, t.specialties.id))
    .leftJoin(t.facilities, eq(t.doctors.facilityId, t.facilities.id))
    .leftJoin(t.districts, eq(t.doctors.districtId, t.districts.id))
    .leftJoin(t.divisions, eq(t.doctors.divisionId, t.divisions.id))
    .where(where);

  const countQuery = db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.doctors)
    .innerJoin(t.specialties, eq(t.doctors.primarySpecialtyId, t.specialties.id))
    .leftJoin(t.facilities, eq(t.doctors.facilityId, t.facilities.id))
    .leftJoin(t.districts, eq(t.doctors.districtId, t.districts.id))
    .leftJoin(t.divisions, eq(t.doctors.divisionId, t.divisions.id))
    .where(where);

  const [rows, counted] = await Promise.all([
    base.orderBy(...orderBy).limit(perPage).offset((page - 1) * perPage),
    countQuery,
  ]);

  return {
    doctors: (rows as RawDoctor[]).map(toView),
    total: counted[0]?.n ?? 0,
    page,
    perPage,
  };
}

/** One doctor, by id or slug. Returns null for anything not bookable. */
export async function getDoctor(idOrSlug: string): Promise<DoctorView | null> {
  const db = getDb();

  // Accept either, so URLs can move to slugs without breaking existing links.
  const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug)
    ? eq(t.doctors.id, idOrSlug)
    : eq(t.doctors.slug, idOrSlug);

  const rows = await db
    .select(publicColumns)
    .from(t.doctors)
    .innerJoin(t.specialties, eq(t.doctors.primarySpecialtyId, t.specialties.id))
    .leftJoin(t.facilities, eq(t.doctors.facilityId, t.facilities.id))
    .leftJoin(t.districts, eq(t.doctors.districtId, t.districts.id))
    .leftJoin(t.divisions, eq(t.doctors.divisionId, t.divisions.id))
    .where(and(identifier, isBookable))
    .limit(1);

  const row = rows[0] as RawDoctor | undefined;
  return row ? toView(row) : null;
}

export interface AvailabilityRule {
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  bufferMinutes: number;
  timezone: string;
}

/** The recurring availability the scheduling engine expands into slots. */
export async function getAvailability(doctorId: string): Promise<AvailabilityRule[]> {
  const db = getDb();
  return db
    .select({
      weekday: t.doctorAvailability.weekday,
      startMinute: t.doctorAvailability.startMinute,
      endMinute: t.doctorAvailability.endMinute,
      slotMinutes: t.doctorAvailability.slotMinutes,
      bufferMinutes: t.doctorAvailability.bufferMinutes,
      timezone: t.doctorAvailability.timezone,
    })
    .from(t.doctorAvailability)
    .where(
      and(
        eq(t.doctorAvailability.doctorId, doctorId),
        eq(t.doctorAvailability.isActive, true),
      ),
    )
    .orderBy(t.doctorAvailability.weekday, t.doctorAvailability.startMinute);
}

/** Add one recurring availability rule to a doctor's own schedule. */
export async function addAvailability(
  doctorId: string,
  rule: Omit<AvailabilityRule, "timezone"> & { timezone?: string },
): Promise<AvailabilityRule> {
  const [row] = await getDb()
    .insert(t.doctorAvailability)
    .values({
      doctorId,
      weekday: rule.weekday,
      startMinute: rule.startMinute,
      endMinute: rule.endMinute,
      slotMinutes: rule.slotMinutes,
      bufferMinutes: rule.bufferMinutes,
      timezone: rule.timezone ?? "Asia/Dhaka",
    })
    .returning({
      weekday: t.doctorAvailability.weekday,
      startMinute: t.doctorAvailability.startMinute,
      endMinute: t.doctorAvailability.endMinute,
      slotMinutes: t.doctorAvailability.slotMinutes,
      bufferMinutes: t.doctorAvailability.bufferMinutes,
      timezone: t.doctorAvailability.timezone,
    });

  return row!;
}

/* -------------------------------------------------------------------------- */
/* Scheduling configuration                                                    */
/* -------------------------------------------------------------------------- */

export interface SchedulingConfig {
  consultationMinutes: number;
  leadMinutes: number;
  cancelWindowMinutes: number;
  bufferMinutes: number;
}

/** The doctor's own booking rules. Read separately from the public profile. */
export async function getSchedulingConfig(doctorId: string): Promise<SchedulingConfig | null> {
  const rows = await getDb()
    .select({
      consultationMinutes: t.doctors.consultationMinutes,
      leadMinutes: t.doctors.leadMinutes,
      cancelWindowMinutes: t.doctors.cancelWindowMinutes,
      bufferMinutes: t.doctors.bufferMinutes,
    })
    .from(t.doctors)
    .where(eq(t.doctors.id, doctorId))
    .limit(1);
  return rows[0] ?? null;
}

/** Date-specific exceptions in a range, shaped for the scheduling engine. */
export async function getAvailabilityExceptions(
  doctorId: string,
  from: Date,
  to: Date,
): Promise<
  Array<{
    date: string;
    type: "block" | "extra";
    startMinute: number | null;
    endMinute: number | null;
    slotMinutes: number | null;
    bufferMinutes: number | null;
    timezone: string;
  }>
> {
  const rows = await getDb()
    .select({
      date: t.availabilityExceptions.date,
      type: t.availabilityExceptions.type,
      startMinute: t.availabilityExceptions.startMinute,
      endMinute: t.availabilityExceptions.endMinute,
      slotMinutes: t.availabilityExceptions.slotMinutes,
      bufferMinutes: t.availabilityExceptions.bufferMinutes,
      timezone: t.availabilityExceptions.timezone,
    })
    .from(t.availabilityExceptions)
    .where(
      and(
        eq(t.availabilityExceptions.doctorId, doctorId),
        gte(t.availabilityExceptions.date, new Date(from.getTime() - 86_400_000)),
        lte(t.availabilityExceptions.date, new Date(to.getTime() + 86_400_000)),
      ),
    );

  return rows.map((r) => ({
    // Stored as a date; the engine works in "YYYY-MM-DD" local keys.
    date: r.date.toISOString().slice(0, 10),
    type: r.type as "block" | "extra",
    startMinute: r.startMinute,
    endMinute: r.endMinute,
    slotMinutes: r.slotMinutes,
    bufferMinutes: r.bufferMinutes,
    timezone: r.timezone,
  }));
}

/**
 * The doctor profile belonging to an account, at any verification status.
 *
 * Distinct from getDoctor(), which only ever returns bookable profiles: a
 * doctor whose application is still pending must be able to see their own
 * workspace, they just must not appear in the directory.
 */
export async function getProfileForUser(userId: string): Promise<{
  id: string;
  displayName: string;
  verificationStatus: string;
  isDemoProfile: boolean;
} | null> {
  const rows = await getDb()
    .select({
      id: t.doctors.id,
      displayName: t.doctors.displayName,
      verificationStatus: t.doctors.verificationStatus,
      isDemoProfile: t.doctors.isDemoProfile,
    })
    .from(t.doctors)
    .where(eq(t.doctors.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}
