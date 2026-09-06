/**
 * Medical records, prescriptions, family members, reviews, notifications and
 * the waitlist.
 *
 * Every function that reads patient data takes the patient id as a REQUIRED
 * argument and scopes on it. None of them accept "all" — there is no way to
 * call these and forget to filter, which is what made the prototype's routes
 * leak (finding S1).
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, type Database } from "../db/client";
import { getSmsProvider, sendNotificationCopy, sendNotificationSms } from "../notifications";
import { logger } from "../observability/logger";
import * as t from "../db/schema";

/* -------------------------------------------------------------------------- */
/* Medical records                                                             */
/* -------------------------------------------------------------------------- */

export interface RecordView {
  id: string;
  patientId: string;
  appointmentId: string | null;
  kind: string;
  title: string;
  note: string | null;
  authorRole: string;
  authorName: string;
  isCurrent: boolean;
  supersedesId: string | null;
  createdAt: string;
}

const recordColumns = {
  id: t.medicalRecords.id,
  patientId: t.medicalRecords.patientId,
  appointmentId: t.medicalRecords.appointmentId,
  kind: t.medicalRecords.kind,
  title: t.medicalRecords.title,
  note: t.medicalRecords.body,
  authorRole: t.medicalRecords.authorRole,
  authorName: t.medicalRecords.authorDisplayName,
  isCurrent: t.medicalRecords.isCurrent,
  supersedesId: t.medicalRecords.supersedesId,
  createdAt: t.medicalRecords.createdAt,
} as const;

const toRecord = (row: Record<string, unknown>): RecordView => ({
  id: row.id as string,
  patientId: row.patientId as string,
  appointmentId: (row.appointmentId as string) ?? null,
  kind: row.kind as string,
  title: row.title as string,
  note: (row.note as string) ?? null,
  authorRole: row.authorRole as string,
  authorName: row.authorName as string,
  isCurrent: Boolean(row.isCurrent),
  supersedesId: (row.supersedesId as string) ?? null,
  createdAt: (row.createdAt as Date).toISOString(),
});

/** Current records for one patient. Superseded versions are not listed. */
export async function listRecords(
  patientId: string,
  db: Database = getDb(),
): Promise<RecordView[]> {
  const rows = await db
    .select(recordColumns)
    .from(t.medicalRecords)
    .where(and(eq(t.medicalRecords.patientId, patientId), eq(t.medicalRecords.isCurrent, true)))
    .orderBy(desc(t.medicalRecords.createdAt));
  return rows.map((r) => toRecord(r as Record<string, unknown>));
}

/** One record, with its owner, so a caller can check ownership before use. */
export async function findRecord(
  id: string,
  db: Database = getDb(),
): Promise<RecordView | null> {
  const rows = await db.select(recordColumns).from(t.medicalRecords).where(eq(t.medicalRecords.id, id)).limit(1);
  return rows[0] ? toRecord(rows[0] as Record<string, unknown>) : null;
}

export interface CreateRecordInput {
  patientId: string;
  authorUserId: string;
  authorRole: "patient" | "doctor" | "admin";
  authorDisplayName: string;
  kind?: "note" | "lab" | "imaging" | "prescription" | "visit_summary" | "upload" | "amendment";
  title: string;
  body?: string | null;
  appointmentId?: string | null;
  visibility?: "patient_visible" | "clinician_only";
}

export async function createRecord(
  input: CreateRecordInput,
  db: Database = getDb(),
): Promise<RecordView> {
  const rows = await db
    .insert(t.medicalRecords)
    .values({
      patientId: input.patientId,
      authorUserId: input.authorUserId,
      authorRole: input.authorRole,
      authorDisplayName: input.authorDisplayName,
      kind: input.kind ?? "note",
      title: input.title,
      body: input.body ?? null,
      appointmentId: input.appointmentId ?? null,
      visibility: input.visibility ?? "patient_visible",
    })
    .returning(recordColumns);
  return toRecord(rows[0] as Record<string, unknown>);
}

/**
 * Amend a record.
 *
 * Inserts a new row that supersedes the original and marks the original not
 * current. The original's content is never touched — a database trigger refuses
 * it — so the history of what was believed, and when, survives the correction.
 */
export async function amendRecord(
  originalId: string,
  input: CreateRecordInput & { amendmentReason: string },
  db: Database = getDb(),
): Promise<RecordView> {
  const rows = await db
    .insert(t.medicalRecords)
    .values({
      patientId: input.patientId,
      authorUserId: input.authorUserId,
      authorRole: input.authorRole,
      authorDisplayName: input.authorDisplayName,
      kind: "amendment",
      title: input.title,
      body: input.body ?? null,
      appointmentId: input.appointmentId ?? null,
      supersedesId: originalId,
      amendmentReason: input.amendmentReason,
    })
    .returning(recordColumns);

  await db
    .update(t.medicalRecords)
    .set({ isCurrent: false })
    .where(eq(t.medicalRecords.id, originalId));

  return toRecord(rows[0] as Record<string, unknown>);
}

/* -------------------------------------------------------------------------- */
/* Prescriptions                                                               */
/* -------------------------------------------------------------------------- */

export interface PrescriptionItemView {
  medicine: string;
  strength: string | null;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  duration: string | null;
  quantity: string | null;
  instructions: string | null;
  /** Legacy alias the existing UI renders. */
  drug: string;
}

export interface PrescriptionView {
  id: string;
  prescriptionNumber: string;
  patientId: string;
  doctorId: string;
  appointmentId: string | null;
  diagnosis: string | null;
  notes: string | null;
  advice: string | null;
  status: string;
  issuedAt: string | null;
  createdAt: string;
  items: PrescriptionItemView[];
  doctor: { id: string; name: string; specialty: string | null } | null;
}

export async function listPrescriptions(
  patientId: string,
  db: Database = getDb(),
): Promise<PrescriptionView[]> {
  const rows = await db
    .select({
      id: t.prescriptions.id,
      prescriptionNumber: t.prescriptions.prescriptionNumber,
      patientId: t.prescriptions.patientId,
      doctorId: t.prescriptions.doctorId,
      appointmentId: t.prescriptions.appointmentId,
      diagnosis: t.prescriptions.diagnosis,
      notes: t.prescriptions.notes,
      advice: t.prescriptions.advice,
      status: t.prescriptions.status,
      issuedAt: t.prescriptions.issuedAt,
      createdAt: t.prescriptions.createdAt,
      doctorName: t.doctors.displayName,
      specialty: t.specialties.name,
    })
    .from(t.prescriptions)
    .leftJoin(t.doctors, eq(t.prescriptions.doctorId, t.doctors.id))
    .leftJoin(t.specialties, eq(t.doctors.primarySpecialtyId, t.specialties.id))
    .where(and(eq(t.prescriptions.patientId, patientId), eq(t.prescriptions.isCurrent, true)))
    .orderBy(desc(t.prescriptions.createdAt));

  if (!rows.length) return [];

  // One query for all items rather than one per prescription.
  const items = await db
    .select()
    .from(t.prescriptionItems)
    .where(inArray(t.prescriptionItems.prescriptionId, rows.map((r) => r.id)))
    .orderBy(t.prescriptionItems.position);

  const byPrescription = new Map<string, PrescriptionItemView[]>();
  for (const item of items) {
    const list = byPrescription.get(item.prescriptionId) ?? [];
    list.push({
      medicine: item.medicine,
      drug: item.medicine,
      strength: item.strength,
      dose: item.dose,
      route: item.route,
      frequency: item.frequency,
      duration: item.duration,
      quantity: item.quantity,
      instructions: item.instructions,
    });
    byPrescription.set(item.prescriptionId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    prescriptionNumber: r.prescriptionNumber,
    patientId: r.patientId,
    doctorId: r.doctorId,
    appointmentId: r.appointmentId,
    diagnosis: r.diagnosis,
    notes: r.notes,
    advice: r.advice,
    status: r.status,
    issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    items: byPrescription.get(r.id) ?? [],
    doctor: r.doctorName ? { id: r.doctorId, name: r.doctorName, specialty: r.specialty } : null,
  }));
}

export async function findPrescription(
  id: string,
  db: Database = getDb(),
): Promise<{ id: string; patientId: string; doctorId: string } | null> {
  const rows = await db
    .select({
      id: t.prescriptions.id,
      patientId: t.prescriptions.patientId,
      doctorId: t.prescriptions.doctorId,
    })
    .from(t.prescriptions)
    .where(eq(t.prescriptions.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export interface CreatePrescriptionInput {
  patientId: string;
  doctorId: string;
  issuedByUserId: string;
  appointmentId?: string | null;
  diagnosis?: string | null;
  notes?: string | null;
  advice?: string | null;
  items: Array<{
    medicine: string;
    strength?: string | null;
    dose?: string | null;
    route?: string | null;
    frequency?: string | null;
    duration?: string | null;
    quantity?: string | null;
    instructions?: string | null;
  }>;
}

export async function createPrescription(
  input: CreatePrescriptionInput,
  db: Database = getDb(),
): Promise<string> {
  const number = `NRM-RX-${Date.now().toString(36).toUpperCase()}`;
  const now = new Date();

  const rows = await db
    .insert(t.prescriptions)
    .values({
      prescriptionNumber: number,
      patientId: input.patientId,
      doctorId: input.doctorId,
      issuedByUserId: input.issuedByUserId,
      appointmentId: input.appointmentId ?? null,
      diagnosis: input.diagnosis ?? null,
      notes: input.notes ?? null,
      advice: input.advice ?? null,
      status: "issued",
      issuedAt: now,
    })
    .returning({ id: t.prescriptions.id });

  const prescriptionId = rows[0]!.id;

  if (input.items.length) {
    await db.insert(t.prescriptionItems).values(
      input.items.map((item, index) => ({
        prescriptionId,
        position: index,
        medicine: item.medicine,
        strength: item.strength ?? null,
        dose: item.dose ?? null,
        route: item.route ?? null,
        frequency: item.frequency ?? null,
        duration: item.duration ?? null,
        quantity: item.quantity ?? null,
        instructions: item.instructions ?? null,
      })),
    );
  }

  return prescriptionId;
}

/* -------------------------------------------------------------------------- */
/* Family                                                                      */
/* -------------------------------------------------------------------------- */

export interface FamilyMemberView {
  id: string;
  patientId: string;
  name: string;
  relation: string;
  gender: string | null;
  initials: string;
  accessLevel: string;
  createdAt: string;
}

export async function listFamily(
  ownerUserId: string,
  db: Database = getDb(),
): Promise<FamilyMemberView[]> {
  const rows = await db
    .select({
      id: t.familyMembers.id,
      patientId: t.familyMembers.patientId,
      name: t.familyMembers.name,
      relation: t.familyMembers.relation,
      gender: t.familyMembers.gender,
      accessLevel: t.familyMembers.accessLevel,
      createdAt: t.familyMembers.createdAt,
    })
    .from(t.familyMembers)
    .innerJoin(t.familyAccounts, eq(t.familyMembers.familyAccountId, t.familyAccounts.id))
    .where(
      and(eq(t.familyAccounts.ownerUserId, ownerUserId), eq(t.familyMembers.isActive, true)),
    )
    .orderBy(t.familyMembers.createdAt);

  return rows.map((r) => ({
    ...r,
    initials:
      r.name
        .split(/\s+/)
        .filter(Boolean)
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase() || "NA",
    createdAt: r.createdAt.toISOString(),
  }));
}

/** The household for a user, created on first use. */
export async function ensureFamilyAccount(
  ownerUserId: string,
  db: Database = getDb(),
): Promise<string> {
  const existing = await db
    .select({ id: t.familyAccounts.id })
    .from(t.familyAccounts)
    .where(eq(t.familyAccounts.ownerUserId, ownerUserId))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const rows = await db
    .insert(t.familyAccounts)
    .values({ ownerUserId, label: "Household" })
    .onConflictDoNothing({ target: t.familyAccounts.ownerUserId })
    .returning({ id: t.familyAccounts.id });
  if (rows[0]) return rows[0].id;

  // Lost the race; the other insert won.
  const again = await db
    .select({ id: t.familyAccounts.id })
    .from(t.familyAccounts)
    .where(eq(t.familyAccounts.ownerUserId, ownerUserId))
    .limit(1);
  return again[0]!.id;
}

/** Confirm a member belongs to this owner. Returns the member's patient id. */
export async function findFamilyMemberForOwner(
  memberId: string,
  ownerUserId: string,
  db: Database = getDb(),
): Promise<{ id: string; patientId: string; name: string; accessLevel: string } | null> {
  const rows = await db
    .select({
      id: t.familyMembers.id,
      patientId: t.familyMembers.patientId,
      name: t.familyMembers.name,
      accessLevel: t.familyMembers.accessLevel,
    })
    .from(t.familyMembers)
    .innerJoin(t.familyAccounts, eq(t.familyMembers.familyAccountId, t.familyAccounts.id))
    .where(
      and(
        eq(t.familyMembers.id, memberId),
        eq(t.familyAccounts.ownerUserId, ownerUserId),
        eq(t.familyMembers.isActive, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function addFamilyMember(
  input: {
    familyAccountId: string;
    patientId: string;
    name: string;
    relation: string;
    gender?: string | null;
    accessLevel?: string;
  },
  db: Database = getDb(),
): Promise<string> {
  const rows = await db
    .insert(t.familyMembers)
    .values({
      familyAccountId: input.familyAccountId,
      patientId: input.patientId,
      name: input.name,
      relation: input.relation,
      gender: input.gender ?? null,
      // Booking on someone's behalf does not imply reading their history.
      accessLevel: input.accessLevel ?? "appointments_only",
      consentGrantedAt: new Date(),
    })
    .returning({ id: t.familyMembers.id });
  return rows[0]!.id;
}

/** Soft-remove. The dependent's clinical record is retained (brief §30). */
export async function removeFamilyMember(memberId: string, db: Database = getDb()): Promise<void> {
  await db
    .update(t.familyMembers)
    .set({ isActive: false, consentRevokedAt: new Date() })
    .where(eq(t.familyMembers.id, memberId));
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

export async function listNotifications(
  userId: string,
  db: Database = getDb(),
): Promise<NotificationView[]> {
  const rows = await db
    .select({
      id: t.notifications.id,
      type: t.notifications.type,
      title: t.notifications.title,
      body: t.notifications.body,
      payload: t.notifications.payload,
      readAt: t.notifications.readAt,
      createdAt: t.notifications.createdAt,
    })
    .from(t.notifications)
    .where(and(eq(t.notifications.userId, userId), eq(t.notifications.channel, "in_app")))
    .orderBy(desc(t.notifications.createdAt))
    .limit(30);

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    payload: (r.payload as Record<string, unknown>) ?? {},
    read: Boolean(r.readAt),
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function markNotificationsRead(
  userId: string,
  db: Database = getDb(),
): Promise<number> {
  const rows = await db
    .update(t.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(t.notifications.userId, userId), isNull(t.notifications.readAt)))
    .returning({ id: t.notifications.id });
  return rows.length;
}

/**
 * Channels a copy can actually be delivered on.
 *
 * Email always; SMS only where a gateway is configured, because the console
 * provider does not send. WhatsApp remains a storable preference with nothing
 * behind it, and nothing here pretends otherwise — a reminder that appears to
 * send and does not is a missed consultation.
 */
function deliverableChannels(): Set<string> {
  return new Set(["email", ...(getSmsProvider().canDeliver ? ["sms"] : [])]);
}

export async function notify(
  input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
    dedupeKey?: string | null;
  },
  db: Database = getDb(),
): Promise<void> {
  const inserted = await db
    .insert(t.notifications)
    .values({
      userId: input.userId,
      channel: "in_app",
      type: input.type,
      title: input.title,
      body: input.body,
      payload: input.payload ?? {},
      dedupeKey: input.dedupeKey ?? null,
      status: "sent",
      sentAt: new Date(),
    })
    // A dedupeKey collision means this notification was already delivered.
    .onConflictDoNothing({ target: t.notifications.dedupeKey })
    .returning({ id: t.notifications.id });

  // Deduped: this was already delivered, and re-sending the copy would be the
  // second email for one event.
  if (!inserted[0]) return;

  await deliverCopies(input, db);
}

/**
 * Send the out-of-app copies this person asked for.
 *
 * Each attempt gets its own notifications row, so "we emailed you" is a fact
 * with a status rather than an assumption — and a failed one is picked up by
 * the notification-retry job like any other.
 *
 * Never throws. A mail provider being down must not roll back the appointment
 * that caused the notification.
 */
async function deliverCopies(
  input: { userId: string; type: string; title: string; body: string; dedupeKey?: string | null },
  db: Database,
): Promise<void> {
  try {
    const rows = await db
      .select({
        email: t.users.email,
        name: t.users.name,
        phone: t.users.phone,
        phoneVerifiedAt: t.users.phoneVerifiedAt,
        channels: t.users.notificationChannels,
      })
      .from(t.users)
      .where(eq(t.users.id, input.userId))
      .limit(1);

    const user = rows[0];
    if (!user) return;

    const wanted = new Set(
      (user.channels ?? []).filter((c) => deliverableChannels().has(c)),
    );

    /** One row per attempt, so "we told you" is a fact with a status. */
    const record = async (channel: "email" | "sms", delivered: boolean): Promise<void> => {
      await db
        .insert(t.notifications)
        .values({
          userId: input.userId,
          channel,
          type: input.type,
          title: input.title,
          body: input.body,
          payload: {},
          dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${channel}` : null,
          status: delivered ? "sent" : "failed",
          sentAt: delivered ? new Date() : null,
        })
        .onConflictDoNothing({ target: t.notifications.dedupeKey });
    };

    if (wanted.has("email") && user.email) {
      const { delivered } = await sendNotificationCopy({
        to: user.email,
        name: user.name,
        title: input.title,
        body: input.body,
      });
      await record("email", delivered);
    }

    /**
     * SMS goes only to a number somebody proved they hold.
     *
     * Without that check the one channel a patient in Bangladesh actually reads
     * would be the one most likely to carry their appointment to a stranger who
     * happens to own the number they mistyped at sign-up.
     */
    if (wanted.has("sms") && user.phone && user.phoneVerifiedAt) {
      const { delivered } = await sendNotificationSms({
        to: user.phone,
        title: input.title,
        body: input.body,
      });
      await record("sms", delivered);
    }
  } catch (err) {
    logger.warn("notification copy failed", { type: input.type, err });
  }
}

/* -------------------------------------------------------------------------- */
/* Reviews                                                                     */
/* -------------------------------------------------------------------------- */

export interface ReviewView {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  patientName: string | null;
}

export async function listReviews(
  doctorId: string,
  db: Database = getDb(),
): Promise<ReviewView[]> {
  const rows = await db
    .select({
      id: t.reviews.id,
      rating: t.reviews.rating,
      comment: t.reviews.comment,
      createdAt: t.reviews.createdAt,
      patientName: t.patients.displayName,
    })
    .from(t.reviews)
    .leftJoin(t.patients, eq(t.reviews.patientId, t.patients.id))
    .where(and(eq(t.reviews.doctorId, doctorId), eq(t.reviews.status, "published")))
    .orderBy(desc(t.reviews.createdAt))
    .limit(50);

  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt.toISOString(),
    patientName: r.patientName,
  }));
}

/**
 * Record a review and update the doctor's aggregate in one transaction, so the
 * average can never drift from the rows it is computed from.
 */
export async function createReview(
  input: {
    appointmentId: string;
    patientId: string;
    doctorId: string;
    authorUserId: string;
    rating: number;
    comment?: string | null;
  },
  db: Database = getDb(),
): Promise<string> {
  const rows = await db
    .insert(t.reviews)
    .values({
      appointmentId: input.appointmentId,
      patientId: input.patientId,
      doctorId: input.doctorId,
      authorUserId: input.authorUserId,
      rating: input.rating,
      comment: input.comment ?? null,
      status: "published",
    })
    .returning({ id: t.reviews.id });

  await db
    .update(t.doctors)
    .set({
      ratingCount: sql`${t.doctors.ratingCount} + 1`,
      ratingAvg: sql`round(
        ((${t.doctors.ratingAvg} * ${t.doctors.ratingCount}) + ${input.rating})
        / (${t.doctors.ratingCount} + 1), 2)`,
    })
    .where(eq(t.doctors.id, input.doctorId));

  return rows[0]!.id;
}

export async function hasReviewed(
  appointmentId: string,
  db: Database = getDb(),
): Promise<boolean> {
  const rows = await db
    .select({ id: t.reviews.id })
    .from(t.reviews)
    .where(eq(t.reviews.appointmentId, appointmentId))
    .limit(1);
  return rows.length > 0;
}
