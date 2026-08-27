/**
 * Niramoy — consultation rooms
 * -----------------------------------------------------------------------------
 * Who may join a consultation, and when.
 *
 * Two people can obtain a token: the patient on the appointment and the doctor
 * on the appointment. Nobody else — not an admin, not the person who booked it
 * on someone's behalf if they are not the patient.
 *
 * And only within a window around the appointment. A token is not a standing
 * right to enter a room; it is permission to attend a consultation that is
 * happening now. Outside the window there is nothing to join.
 */

import { eq } from "drizzle-orm";

import { audit } from "../audit";

import { getDb } from "../db/client";
import * as t from "../db/schema";
import { AppError } from "../errors";
import * as appointments from "../repositories/appointments";
import * as directory from "../repositories/doctors";
import type { Principal } from "../security/authz";
import { getVideoProvider, type JoinGrant, type RoomHandle } from "../video/provider";

/** How early a participant may join, and how long after the end it stays open. */
export const JOIN_OPENS_MINUTES_BEFORE = 15;
export const JOIN_CLOSES_MINUTES_AFTER = 30;

/** Token lifetime. Short: it is re-minted on demand, so there is no reason to
 *  hand out anything long-lived. */
export const TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Issue a join grant for an appointment.
 *
 * Creates the room on first use rather than at booking time — a room provisioned
 * for a consultation that is then cancelled is waste, and one provisioned weeks
 * ahead has a long window in which to leak.
 */
export async function getJoinGrant(
  principal: Principal,
  appointmentId: string,
  context: { requestId?: string },
): Promise<JoinGrant & { appointmentId: string; role: "doctor" | "patient" }> {
  const db = getDb();

  const appointment = await appointments.findById(appointmentId);
  if (!appointment) throw new AppError("NOT_FOUND");

  /* ---- Participation ---------------------------------------------------- */

  let role: "doctor" | "patient";

  if (principal.role === "patient") {
    if (!principal.patientId || appointment.patientId !== principal.patientId) {
      // Not their consultation. 404, not 403 — whether it exists is not theirs
      // to learn.
      throw new AppError("NOT_FOUND");
    }
    role = "patient";
  } else if (principal.role === "doctor") {
    const profile = await directory.getProfileForUser(principal.userId);
    if (!profile || profile.id !== appointment.doctorId) throw new AppError("NOT_FOUND");
    role = "doctor";
  } else {
    // An admin has no place in a consultation.
    throw new AppError("NOT_FOUND");
  }

  /* ---- Status and timing ------------------------------------------------ */

  if (["cancelled", "no_show"].includes(appointment.status)) {
    throw new AppError("NOT_ELIGIBLE", { message: "This consultation is no longer scheduled." });
  }

  const now = Date.now();
  const opens = appointment.startUtc.getTime() - JOIN_OPENS_MINUTES_BEFORE * 60_000;
  const closes = appointment.endUtc.getTime() + JOIN_CLOSES_MINUTES_AFTER * 60_000;

  if (now < opens) {
    throw new AppError("NOT_ELIGIBLE", {
      message: `The room opens ${JOIN_OPENS_MINUTES_BEFORE} minutes before your appointment.`,
      meta: { opensAt: new Date(opens).toISOString() },
    });
  }
  if (now > closes) {
    throw new AppError("NOT_ELIGIBLE", { message: "This consultation has ended." });
  }

  /* ---- Room ------------------------------------------------------------- */

  const provider = getVideoProvider();
  const expiresAt = new Date(closes);

  const existing = await db
    .select()
    .from(t.videoSessions)
    .where(eq(t.videoSessions.appointmentId, appointmentId))
    .limit(1);

  let room: RoomHandle;

  if (existing[0] && existing[0].expiresAt.getTime() > now && !existing[0].endedAt) {
    room = {
      roomName: existing[0].roomName,
      providerRoomId: existing[0].providerRoomId,
      expiresAt: existing[0].expiresAt,
    };
  } else {
    room = await provider.createRoom({ appointmentId, expiresAt });
    await db
      .insert(t.videoSessions)
      .values({
        appointmentId,
        provider: provider.name,
        roomName: room.roomName,
        providerRoomId: room.providerRoomId,
        expiresAt: room.expiresAt,
        recordingEnabled: false,
      })
      .onConflictDoUpdate({
        target: t.videoSessions.appointmentId,
        set: {
          provider: provider.name,
          roomName: room.roomName,
          providerRoomId: room.providerRoomId,
          expiresAt: room.expiresAt,
          endedAt: null,
        },
      });
  }

  const grant = await provider.getJoinToken({
    room,
    userId: principal.userId,
    displayName: principal.name,
    role,
    // Never outlive the room itself.
    ttlSeconds: Math.min(TOKEN_TTL_SECONDS, Math.max(60, Math.floor((closes - now) / 1000))),
  });

  await db
    .update(t.videoSessions)
    .set(role === "doctor" ? { doctorJoinedAt: new Date() } : { patientJoinedAt: new Date() })
    .where(eq(t.videoSessions.appointmentId, appointmentId));

  await audit({
    action: "video.token_issue",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId: context.requestId,
    resourceType: "appointment",
    resourceId: appointmentId,
    // The token itself is never logged, here or anywhere.
    metadata: { provider: provider.name, role, isDemo: grant.isDemo },
  });

  return { ...grant, appointmentId, role };
}

/** Called when a consultation is completed or cancelled. */
export async function endRoom(appointmentId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(t.videoSessions)
    .where(eq(t.videoSessions.appointmentId, appointmentId))
    .limit(1);

  const session = rows[0];
  if (!session || session.endedAt) return;

  await getVideoProvider()
    .endRoom({
      roomName: session.roomName,
      providerRoomId: session.providerRoomId,
      expiresAt: session.expiresAt,
    })
    .catch(() => {
      /* the provider may have expired it already */
    });

  await db
    .update(t.videoSessions)
    .set({ endedAt: new Date() })
    .where(eq(t.videoSessions.appointmentId, appointmentId));
}

/** Whether the consultation UI should present a real call or say it is a demo. */
export const isDemoVideo = (): boolean => getVideoProvider().name === "demo";

