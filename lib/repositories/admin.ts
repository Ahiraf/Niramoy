/**
 * Admin read models.
 *
 * Every query here is deliberately aggregate or administrative. An admin has a
 * legitimate need to see platform health, the verification queue and the audit
 * trail; they have no clinical need to read a patient's history, and there is no
 * function in this file that would let them.
 */
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import { audit } from "../audit";
import { getDb } from "../db/client";
import * as t from "../db/schema";
import type { Principal } from "../security/authz";

export interface AdminOverview {
  doctors: { total: number; verified: number; pending: number; suspended: number; demo: number };
  appointments: { total: number; upcoming: number; completed: number; cancelled: number; noShow: number };
  patients: number;
  safety: { emergencies7d: number; downgradesBlocked7d: number; summariesPending: number };
  verifications: { pending: number };
}

export async function adminOverview(): Promise<AdminOverview> {
  const db = getDb();

  const [doctors] = await db
    .select({
      total: sql<number>`count(*)::int`,
      verified: sql<number>`count(*) FILTER (WHERE ${t.doctors.verificationStatus} = 'verified')::int`,
      pending: sql<number>`count(*) FILTER (WHERE ${t.doctors.verificationStatus} = 'pending')::int`,
      suspended: sql<number>`count(*) FILTER (WHERE ${t.doctors.verificationStatus} = 'suspended')::int`,
      demo: sql<number>`count(*) FILTER (WHERE ${t.doctors.isDemoProfile})::int`,
    })
    .from(t.doctors);

  const [appointments] = await db
    .select({
      total: sql<number>`count(*)::int`,
      upcoming: sql<number>`count(*) FILTER (WHERE ${t.appointments.status} = 'confirmed' AND ${t.appointments.startUtc} > now())::int`,
      completed: sql<number>`count(*) FILTER (WHERE ${t.appointments.status} = 'completed')::int`,
      cancelled: sql<number>`count(*) FILTER (WHERE ${t.appointments.status} = 'cancelled')::int`,
      noShow: sql<number>`count(*) FILTER (WHERE ${t.appointments.status} = 'no_show')::int`,
    })
    .from(t.appointments);

  const [patients] = await db.select({ n: sql<number>`count(*)::int` }).from(t.patients);

  const [safety] = await db
    .select({
      emergencies: sql<number>`count(*) FILTER (WHERE ${t.aiTriageSessions.redFlagTriggered} AND ${t.aiTriageSessions.createdAt} > now() - interval '7 days')::int`,
      downgrades: sql<number>`count(*) FILTER (WHERE ${t.aiTriageSessions.llmDowngradeBlocked} AND ${t.aiTriageSessions.createdAt} > now() - interval '7 days')::int`,
    })
    .from(t.aiTriageSessions);

  const [summaries] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.aiVisitSummaries)
    .where(eq(t.aiVisitSummaries.reviewStatus, "pending"));

  const [verifications] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.doctorVerifications)
    .where(eq(t.doctorVerifications.status, "pending"));

  return {
    doctors: {
      total: doctors?.total ?? 0,
      verified: doctors?.verified ?? 0,
      pending: doctors?.pending ?? 0,
      suspended: doctors?.suspended ?? 0,
      demo: doctors?.demo ?? 0,
    },
    appointments: {
      total: appointments?.total ?? 0,
      upcoming: appointments?.upcoming ?? 0,
      completed: appointments?.completed ?? 0,
      cancelled: appointments?.cancelled ?? 0,
      noShow: appointments?.noShow ?? 0,
    },
    patients: patients?.n ?? 0,
    safety: {
      emergencies7d: safety?.emergencies ?? 0,
      downgradesBlocked7d: safety?.downgrades ?? 0,
      summariesPending: summaries?.n ?? 0,
    },
    verifications: { pending: verifications?.n ?? 0 },
  };
}

export interface AdminDoctorRow {
  id: string;
  name: string;
  specialty: string | null;
  district: string | null;
  verificationStatus: string;
  isDemoProfile: boolean;
  suspendedAt: string | null;
  suspensionReason: string | null;
  ratingAvg: number;
  ratingCount: number;
  /** Present so an admin can cross-check against the register. */
  registrationNumber: string | null;
}

export async function adminDoctorList(filter: {
  status?: string;
  search?: string;
}): Promise<{ doctors: AdminDoctorRow[]; total: number }> {
  const db = getDb();
  const conditions: SQL[] = [];

  if (filter.status && filter.status !== "all") {
    conditions.push(eq(t.doctors.verificationStatus, filter.status as never));
  }
  if (filter.search) {
    const like = `%${filter.search}%`;
    const match = or(ilike(t.doctors.displayName, like), ilike(t.doctors.bmdcNumber, like));
    if (match) conditions.push(match);
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: t.doctors.id,
      name: t.doctors.displayName,
      specialty: t.specialties.name,
      district: t.districts.name,
      verificationStatus: t.doctors.verificationStatus,
      isDemoProfile: t.doctors.isDemoProfile,
      suspendedAt: t.doctors.suspendedAt,
      suspensionReason: t.doctors.suspensionReason,
      ratingAvg: t.doctors.ratingAvg,
      ratingCount: t.doctors.ratingCount,
      // Visible to an ADMIN only. It is never selected in the public views.
      registrationNumber: t.doctors.bmdcNumber,
    })
    .from(t.doctors)
    .leftJoin(t.specialties, eq(t.doctors.primarySpecialtyId, t.specialties.id))
    .leftJoin(t.districts, eq(t.doctors.districtId, t.districts.id))
    .where(where)
    .orderBy(desc(t.doctors.createdAt))
    .limit(200);

  return {
    doctors: rows.map((r) => ({
      ...r,
      suspendedAt: r.suspendedAt ? r.suspendedAt.toISOString() : null,
      ratingAvg: Number(r.ratingAvg),
    })),
    total: rows.length,
  };
}

export async function reinstateDoctor(
  admin: Principal,
  doctorId: string,
  context: { requestId?: string },
): Promise<void> {
  await getDb()
    .update(t.doctors)
    .set({ verificationStatus: "verified", suspendedAt: null, suspensionReason: null })
    .where(and(eq(t.doctors.id, doctorId), eq(t.doctors.verificationStatus, "suspended")));

  await audit({
    action: "doctor.reinstate",
    actorUserId: admin.userId,
    actorRole: admin.role,
    requestId: context.requestId,
    resourceType: "doctor",
    resourceId: doctorId,
  });
}

export async function adminAuditLog(filter: { action?: string; limit?: number }): Promise<
  Array<{
    id: string;
    occurredAt: string;
    action: string;
    actorRole: string | null;
    resourceType: string | null;
    resourceId: string | null;
    outcome: string;
    metadata: unknown;
  }>
> {
  const db = getDb();
  const rows = await db
    .select({
      id: t.auditLogs.id,
      occurredAt: t.auditLogs.occurredAt,
      action: t.auditLogs.action,
      actorRole: t.auditLogs.actorRole,
      resourceType: t.auditLogs.resourceType,
      resourceId: t.auditLogs.resourceId,
      outcome: t.auditLogs.outcome,
      metadata: t.auditLogs.metadata,
    })
    .from(t.auditLogs)
    .where(filter.action ? eq(t.auditLogs.action, filter.action) : undefined)
    .orderBy(desc(t.auditLogs.occurredAt))
    .limit(Math.min(500, filter.limit ?? 100));

  return rows.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() }));
}

export async function adminSafetyEvents(filter: { limit?: number }): Promise<
  Array<{ id: string; type: string; severity: number; occurredAt: string; detail: unknown }>
> {
  const rows = await getDb()
    .select({
      id: t.safetyEvents.id,
      type: t.safetyEvents.type,
      severity: t.safetyEvents.severity,
      occurredAt: t.safetyEvents.occurredAt,
      detail: t.safetyEvents.detail,
    })
    .from(t.safetyEvents)
    .orderBy(desc(t.safetyEvents.severity), desc(t.safetyEvents.occurredAt))
    .limit(Math.min(200, filter.limit ?? 50));

  return rows.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() }));
}

