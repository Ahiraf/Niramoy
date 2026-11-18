import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import * as t from "../db/schema";
import { AppError } from "../errors";
import type { Principal } from "../security/authz";

function scope(principal: Principal) {
  if (principal.role === "patient" && principal.patientId) {
    return eq(t.appointments.patientId, principal.patientId);
  }
  if (principal.role === "doctor") return eq(t.doctors.userId, principal.userId);
  throw new AppError("FORBIDDEN");
}

function threads(principal: Principal) {
  return getDb().select({
    id: t.appointments.id, reference: t.appointments.reference,
    startUtc: t.appointments.startUtc, status: t.appointments.status,
    doctorName: t.doctors.displayName, patientName: t.patients.displayName,
    doctorUserId: t.doctors.userId,
  }).from(t.appointments)
    .innerJoin(t.doctors, eq(t.doctors.id, t.appointments.doctorId))
    .innerJoin(t.patients, eq(t.patients.id, t.appointments.patientId))
    .where(and(scope(principal), sql`${t.doctors.userId} is not null`));
}

export async function inbox(principal: Principal) {
  const rows = await threads(principal).orderBy(desc(t.appointments.startUtc));
  if (!rows.length) return [];
  const counts = await getDb().select({
    appointmentId: t.careMessages.appointmentId,
    unread: sql<number>`count(*)::int`,
  }).from(t.careMessages).where(and(
    inArray(t.careMessages.appointmentId, rows.map((r) => r.id)),
    ne(t.careMessages.senderId, principal.userId), isNull(t.careMessages.readAt),
  )).groupBy(t.careMessages.appointmentId);
  return rows.map(({ doctorUserId: _doctorUserId, ...r }) => ({
    ...r, unread: counts.find((c) => c.appointmentId === r.id)?.unread ?? 0,
    peerName: principal.role === "doctor" ? r.patientName : r.doctorName,
  }));
}

async function participation(principal: Principal, appointmentId: string) {
  // Apply the participant predicate in SQL, including on reads and receipts.
  const rows = await getDb().select({ status: t.appointments.status })
    .from(t.appointments).innerJoin(t.doctors, eq(t.doctors.id, t.appointments.doctorId))
    .where(and(scope(principal), eq(t.appointments.id, appointmentId), sql`${t.doctors.userId} is not null`)).limit(1);
  if (!rows[0]) throw new AppError("NOT_FOUND");
  return rows[0];
}

export async function history(principal: Principal, appointmentId: string, before?: string) {
  await participation(principal, appointmentId);
  const conditions = [eq(t.careMessages.appointmentId, appointmentId)];
  if (before) {
    const [cursor] = await getDb().select().from(t.careMessages)
      .where(and(eq(t.careMessages.id, before), eq(t.careMessages.appointmentId, appointmentId)));
    if (!cursor) throw new AppError("NOT_FOUND");
    conditions.push(sql`(${t.careMessages.createdAt}, ${t.careMessages.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`);
  }
  const rows = await getDb().select().from(t.careMessages).where(and(...conditions))
    .orderBy(desc(t.careMessages.createdAt), desc(t.careMessages.id)).limit(51);
  return { messages: rows.slice(0, 50).reverse().map(({ senderId, clientId: _clientId, ...r }) => ({
    ...r, mine: senderId === principal.userId,
  })), hasMore: rows.length > 50 };
}

export async function send(principal: Principal, input: { appointmentId: string; clientId: string; body: string }) {
  const appointment = await participation(principal, input.appointmentId);
  if (appointment.status === "cancelled") throw new AppError("NOT_ELIGIBLE", { message: "This appointment was cancelled. You can still read this conversation." });
  const [message] = await getDb().insert(t.careMessages).values({ ...input, senderId: principal.userId })
    .onConflictDoNothing({ target: [t.careMessages.senderId, t.careMessages.clientId] }).returning();
  if (message) return { id: message.id };
  const [existing] = await getDb().select().from(t.careMessages).where(and(
    eq(t.careMessages.senderId, principal.userId), eq(t.careMessages.clientId, input.clientId),
  ));
  if (!existing || existing.appointmentId !== input.appointmentId || existing.body !== input.body) {
    throw new AppError("VALIDATION_FAILED");
  }
  return { id: existing.id };
}

export async function markRead(principal: Principal, appointmentId: string, ids: string[]) {
  await participation(principal, appointmentId);
  await getDb().update(t.careMessages).set({ readAt: new Date() }).where(and(
    eq(t.careMessages.appointmentId, appointmentId), inArray(t.careMessages.id, ids),
    ne(t.careMessages.senderId, principal.userId), isNull(t.careMessages.readAt),
  ));
}
