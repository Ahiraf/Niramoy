/**
 * Reference data: specialties, geography, facilities, platform counts.
 *
 * Everything the filter UI needs, shaped exactly as the existing frontend
 * expects it (see app/components/patient/find-doctors.js), so the migration to
 * Postgres is invisible above this layer.
 */
import { and, eq, sql } from "drizzle-orm";

import { getDb } from "../db/client";
import * as t from "../db/schema";

export interface SpecialtyView {
  id: string;
  name: string;
  bn: string | null;
  icon: string | null;
  blurb: string | null;
  doctorCount: number;
}

export interface DivisionView {
  id: string;
  name: string;
  bn: string | null;
  districts: string[];
  doctorCount: number;
}

export interface FacilityView {
  id: string;
  name: string;
  type: string | null;
  district: string | null;
  division: string | null;
}

/** Only a verified, non-suspended profile counts towards a directory total. */
const bookable = and(
  eq(t.doctors.verificationStatus, "verified"),
  sql`${t.doctors.suspendedAt} IS NULL`,
);

export async function listSpecialties(): Promise<SpecialtyView[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: t.specialties.id,
      name: t.specialties.name,
      bn: t.specialties.nameBn,
      icon: t.specialties.icon,
      blurb: t.specialties.blurb,
      sortOrder: t.specialties.sortOrder,
      doctorCount: sql<number>`count(${t.doctors.id})::int`,
    })
    .from(t.specialties)
    .leftJoin(
      t.doctors,
      and(eq(t.doctors.primarySpecialtyId, t.specialties.id), bookable),
    )
    .where(eq(t.specialties.isActive, true))
    .groupBy(
      t.specialties.id,
      t.specialties.name,
      t.specialties.nameBn,
      t.specialties.icon,
      t.specialties.blurb,
      t.specialties.sortOrder,
    )
    .orderBy(t.specialties.sortOrder);

  return rows.map(({ sortOrder: _sortOrder, ...s }) => s);
}

export async function listDivisions(): Promise<DivisionView[]> {
  const db = getDb();

  const [divisionRows, districtRows] = await Promise.all([
    db
      .select({
        id: t.divisions.id,
        name: t.divisions.name,
        bn: t.divisions.nameBn,
        sortOrder: t.divisions.sortOrder,
        doctorCount: sql<number>`count(${t.doctors.id})::int`,
      })
      .from(t.divisions)
      .leftJoin(t.doctors, and(eq(t.doctors.divisionId, t.divisions.id), bookable))
      .groupBy(t.divisions.id, t.divisions.name, t.divisions.nameBn, t.divisions.sortOrder)
      .orderBy(t.divisions.sortOrder),

    db
      .select({ divisionId: t.districts.divisionId, name: t.districts.name })
      .from(t.districts)
      .orderBy(t.districts.name),
  ]);

  const byDivision = new Map<string, string[]>();
  for (const d of districtRows) {
    const list = byDivision.get(d.divisionId) ?? [];
    list.push(d.name);
    byDivision.set(d.divisionId, list);
  }

  return divisionRows.map(({ sortOrder: _sortOrder, ...d }) => ({
    ...d,
    districts: byDivision.get(d.id) ?? [],
  }));
}

export async function listFacilities(): Promise<FacilityView[]> {
  const db = getDb();
  return db
    .select({
      id: t.facilities.id,
      name: t.facilities.name,
      type: t.facilities.kind,
      district: t.districts.name,
      division: t.divisions.name,
    })
    .from(t.facilities)
    .leftJoin(t.districts, eq(t.facilities.districtId, t.districts.id))
    .leftJoin(t.divisions, eq(t.facilities.divisionId, t.divisions.id))
    .orderBy(t.facilities.name);
}

export interface PlatformStats {
  doctors: number;
  demoDoctors: number;
  realDoctors: number;
  divisionsCovered: number;
  districtsCovered: number;
  specialties: number;
  appointments: number;
  pendingVerifications: number;
}

/** Directory coverage, for the landing page and the admin overview. */
export async function platformStats(): Promise<PlatformStats> {
  const db = getDb();

  const [directory] = await db
    .select({
      doctors: sql<number>`count(*)::int`,
      demoDoctors: sql<number>`count(*) FILTER (WHERE ${t.doctors.isDemoProfile})::int`,
      realDoctors: sql<number>`count(*) FILTER (WHERE NOT ${t.doctors.isDemoProfile})::int`,
      divisionsCovered: sql<number>`count(DISTINCT ${t.doctors.divisionId})::int`,
      districtsCovered: sql<number>`count(DISTINCT ${t.doctors.districtId})::int`,
      specialties: sql<number>`count(DISTINCT ${t.doctors.primarySpecialtyId})::int`,
    })
    .from(t.doctors)
    .where(bookable);

  const [appointments] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.appointments);

  const [pending] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.doctorVerifications)
    .where(eq(t.doctorVerifications.status, "pending"));

  return {
    doctors: directory?.doctors ?? 0,
    demoDoctors: directory?.demoDoctors ?? 0,
    realDoctors: directory?.realDoctors ?? 0,
    divisionsCovered: directory?.divisionsCovered ?? 0,
    districtsCovered: directory?.districtsCovered ?? 0,
    specialties: directory?.specialties ?? 0,
    appointments: appointments?.n ?? 0,
    pendingVerifications: pending?.n ?? 0,
  };
}
