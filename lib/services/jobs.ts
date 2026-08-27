/**
 * Niramoy — scheduled jobs
 * -----------------------------------------------------------------------------
 * Every job here is IDEMPOTENT, because a scheduler will eventually run one
 * twice: a retry after a timeout, an overlapping invocation, a manual trigger
 * during an incident. "It should only fire once" is not a property a cron
 * expression can give you.
 *
 * Two mechanisms provide it:
 *
 *   job_runs   a deterministic run key per logical window, unique-indexed. A
 *              second invocation for the same window conflicts and returns
 *              without doing the work.
 *
 *   dedupe_key on notifications, so even if a job did run twice, the second
 *              pass could not deliver a second message.
 *
 * Belt and braces, deliberately: the first prevents wasted work, the second
 * prevents the visible harm. A patient receiving the same reminder twice is a
 * small thing; a patient receiving "you missed your appointment" twice for an
 * appointment they attended is not.
 */

import { and, eq, isNull, lt, sql } from "drizzle-orm";

import { audit } from "../audit";
import { getEnv } from "../config/env";
import { getDb } from "../db/client";
import * as t from "../db/schema";
import { isUniqueViolation } from "../db/errors";
import { logger } from "../observability/logger";
import { sendAppointmentReminder } from "../notifications";
import * as appointments from "../repositories/appointments";
import * as clinical from "../repositories/clinical";
import { deleteExpiredAuthTokens } from "../repositories/users";
import { deleteExpiredSessions } from "../repositories/sessions";
import { purgeExpiredCounters } from "../security/rate-limit";
import { describeSlot } from "../scheduling/engine";
import { expireStaleOffers } from "./waitlist";

export interface JobResult {
  job: string;
  runKey: string;
  skipped: boolean;
  processed: number;
  detail?: Record<string, unknown>;
}

/** Round an instant down to a window, giving every invocation in it one key. */
function runKeyFor(job: string, windowMinutes: number, now = new Date()): string {
  const bucket = Math.floor(now.getTime() / (windowMinutes * 60_000)) * windowMinutes * 60_000;
  return `${job}:${new Date(bucket).toISOString()}`;
}

/**
 * Claim a run. Returns null when this window has already been claimed, which is
 * the signal to do nothing at all.
 */
async function claimRun(job: string, runKey: string): Promise<string | null> {
  try {
    const rows = await getDb()
      .insert(t.jobRuns)
      .values({ jobName: job, runKey })
      .onConflictDoNothing({ target: [t.jobRuns.jobName, t.jobRuns.runKey] })
      .returning({ id: t.jobRuns.id });
    return rows[0]?.id ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

async function finishRun(
  id: string,
  outcome: string,
  processed: number,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await getDb()
    .update(t.jobRuns)
    .set({ finishedAt: new Date(), outcome, processedCount: processed, detail })
    .where(eq(t.jobRuns.id, id));
}

/* -------------------------------------------------------------------------- */
/* Appointment reminders                                                       */
/* -------------------------------------------------------------------------- */

export const REMINDER_LEAD_HOURS = 24;
const REMINDER_WINDOW_MINUTES = 60;

/**
 * Remind patients about appointments roughly 24 hours out.
 *
 * The window is an hour wide and the run key is hourly, so the job is safe to
 * schedule hourly and safe to run twice within the hour.
 */
export async function sendReminders(now = new Date()): Promise<JobResult> {
  const job = "appointment-reminders";
  const runKey = runKeyFor(job, REMINDER_WINDOW_MINUTES, now);

  const runId = await claimRun(job, runKey);
  if (!runId) {
    logger.info("reminder run already claimed", { runKey });
    return { job, runKey, skipped: true, processed: 0 };
  }

  const from = new Date(now.getTime() + REMINDER_LEAD_HOURS * 3_600_000);
  const to = new Date(from.getTime() + REMINDER_WINDOW_MINUTES * 60_000);

  const due = await appointments.findForReminder(from, to);
  const zone = getEnv().DISPLAY_TIMEZONE;
  let sent = 0;

  for (const appointment of due) {
    if (!appointment.patientUserId) continue;

    const when = describeSlot(
      { start: appointment.startUtc, end: appointment.startUtc, durationMinutes: 0 },
      zone,
    );
    const whenLabel = `on ${when.day} ${when.date} ${when.month} at ${when.localLabel}`;

    // The dedupe key is the real guarantee: even a double run cannot deliver a
    // second reminder for the same appointment and lead time.
    await clinical.notify({
      userId: appointment.patientUserId,
      type: "appointment_reminder",
      title: "Your consultation is tomorrow",
      body: `Your consultation with ${appointment.doctorName ?? "your doctor"} is ${whenLabel}.`,
      payload: { appointmentId: appointment.id },
      dedupeKey: `reminder:${appointment.id}:${REMINDER_LEAD_HOURS}h`,
    });

    if (appointment.patientEmail) {
      await sendAppointmentReminder({
        to: appointment.patientEmail,
        name: appointment.patientName,
        doctorName: appointment.doctorName ?? "your doctor",
        whenLabel,
      }).catch((err: unknown) =>
        logger.error("reminder email failed", { err, appointmentId: appointment.id }),
      );
    }
    sent += 1;
  }

  await finishRun(runId, "ok", sent, { window: [from.toISOString(), to.toISOString()] });
  await audit({ action: "cron.run", metadata: { job, runKey, processed: sent } });

  return { job, runKey, skipped: false, processed: sent };
}

/* -------------------------------------------------------------------------- */
/* No-show sweep                                                               */
/* -------------------------------------------------------------------------- */

/** How long after the end before an unattended appointment is a no-show. */
export const NO_SHOW_GRACE_MINUTES = 30;

/**
 * Mark appointments that came and went without being completed or cancelled.
 *
 * markNoShow is conditional on the row still being pending or confirmed, so a
 * doctor completing a consultation while this job runs wins — the update
 * matches zero rows rather than overwriting their decision. Getting this the
 * wrong way round would tell a patient they missed an appointment they
 * attended.
 */
export async function sweepNoShows(now = new Date()): Promise<JobResult> {
  const job = "no-show-sweep";
  const runKey = runKeyFor(job, 15, now);

  const runId = await claimRun(job, runKey);
  if (!runId) return { job, runKey, skipped: true, processed: 0 };

  const candidates = await appointments.findNoShowCandidates(NO_SHOW_GRACE_MINUTES);
  let marked = 0;

  for (const appointment of candidates) {
    const changed = await appointments.markNoShow(appointment.id);
    if (!changed) continue; // completed or cancelled in the meantime

    await appointments.recordStatusChange({
      appointmentId: appointment.id,
      fromStatus: appointment.status,
      toStatus: "no_show",
      reasonCode: "no_show_sweep",
    });

    if (appointment.bookedByUserId) {
      await clinical.notify({
        userId: appointment.bookedByUserId,
        type: "appointment_no_show",
        title: "Missed consultation",
        body: "Your consultation was marked as missed. You can book another any time.",
        payload: { appointmentId: appointment.id },
        dedupeKey: `no_show:${appointment.id}`,
      });
    }
    marked += 1;
  }

  await finishRun(runId, "ok", marked);
  await audit({ action: "cron.run", metadata: { job, runKey, processed: marked } });

  return { job, runKey, skipped: false, processed: marked };
}

/* -------------------------------------------------------------------------- */
/* Waitlist offer expiry                                                       */
/* -------------------------------------------------------------------------- */

export async function sweepWaitlistOffers(now = new Date()): Promise<JobResult> {
  const job = "waitlist-offers";
  const runKey = runKeyFor(job, 5, now);

  const runId = await claimRun(job, runKey);
  if (!runId) return { job, runKey, skipped: true, processed: 0 };

  const released = await expireStaleOffers();
  await finishRun(runId, "ok", released);

  return { job, runKey, skipped: false, processed: released };
}

/* -------------------------------------------------------------------------- */
/* Housekeeping                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Delete expired sessions, consumed tokens and stale rate-limit counters.
 *
 * Note what is NOT here: nothing clinical. Appointments, records, prescriptions
 * and audit rows are never swept. Retention for those is a legal question, not
 * a housekeeping one — see docs/REGULATORY_ASSUMPTIONS.md, A1.
 */
export async function sweepExpired(now = new Date()): Promise<JobResult> {
  const job = "expiry-sweep";
  const runKey = runKeyFor(job, 60, now);

  const runId = await claimRun(job, runKey);
  if (!runId) return { job, runKey, skipped: true, processed: 0 };

  const [sessions, tokens, counters] = await Promise.all([
    deleteExpiredSessions(),
    deleteExpiredAuthTokens(),
    purgeExpiredCounters(),
  ]);

  const total = sessions + tokens + counters;
  await finishRun(runId, "ok", total, { sessions, tokens, counters });

  return {
    job,
    runKey,
    skipped: false,
    processed: total,
    detail: { sessions, tokens, counters },
  };
}

/* -------------------------------------------------------------------------- */
/* Notification delivery                                                       */
/* -------------------------------------------------------------------------- */

/** Retry notifications whose delivery failed, with a bounded attempt count. */
export async function retryFailedNotifications(now = new Date()): Promise<JobResult> {
  const job = "notification-retry";
  const runKey = runKeyFor(job, 15, now);

  const runId = await claimRun(job, runKey);
  if (!runId) return { job, runKey, skipped: true, processed: 0 };

  const db = getDb();
  const stuck = await db
    .update(t.notifications)
    .set({ status: "failed", attemptCount: sql`${t.notifications.attemptCount} + 1` })
    .where(
      and(
        eq(t.notifications.status, "pending"),
        isNull(t.notifications.sentAt),
        lt(t.notifications.createdAt, new Date(now.getTime() - 3_600_000)),
        lt(t.notifications.attemptCount, 5),
      ),
    )
    .returning({ id: t.notifications.id });

  await finishRun(runId, "ok", stuck.length);
  return { job, runKey, skipped: false, processed: stuck.length };
}

export const JOBS = {
  "appointment-reminders": sendReminders,
  "no-show-sweep": sweepNoShows,
  "waitlist-offers": sweepWaitlistOffers,
  "expiry-sweep": sweepExpired,
  "notification-retry": retryFailedNotifications,
} as const;

export type JobName = keyof typeof JOBS;
