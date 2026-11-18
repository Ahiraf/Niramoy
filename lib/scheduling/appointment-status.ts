/** Expired bookings leave Upcoming even if cron is delayed. Only the doctor
 * confirms completion; a room token alone is not evidence of consultation. */
export function appointmentStatus(
  appointment: { status: string; endUtc: string | Date },
  now = Date.now(),
): string {
  if (["pending", "confirmed"].includes(appointment.status) &&
      new Date(appointment.endUtc).getTime() <= now) return "no_show";
  return appointment.status;
}
