"use client";

/**
 * Calendar export.
 *
 * Built in the browser from data the patient already has, so downloading an
 * appointment does not involve telling the server that you did — a request to
 * /api/appointments/:id/calendar would put "opened their calendar" in the
 * access log next to a consultation, and nothing needs that.
 *
 * Times are written as UTC (the trailing Z form). An .ics file carrying a local
 * time without a VTIMEZONE block is ambiguous, and importing it into a calendar
 * set to another zone silently shifts the appointment — the exact failure this
 * feature exists to prevent.
 */

/** RFC 5545 wants 20260905T172000Z. */
const stamp = (value) =>
  new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * Escape per RFC 5545: backslash, semicolon, comma and newline are structural.
 * A doctor named "Rahman, Jr." would otherwise split the field in two.
 */
const escape = (text) =>
  String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");

/**
 * Lines must not exceed 75 octets; long ones continue with a leading space.
 * Folding on characters rather than octets is near enough here because the
 * fields that get long — doctor names, facility names — are the ones we write.
 */
const fold = (line) => {
  if (line.length <= 73) return line;
  const parts = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length > 72) {
    parts.push(` ${rest.slice(0, 72)}`);
    rest = rest.slice(72);
  }
  parts.push(` ${rest}`);
  return parts.join("\r\n");
};

export function appointmentToIcs(appointment, { appUrl = "" } = {}) {
  const doctor = appointment.doctor?.name ?? "your doctor";
  const isVideo = appointment.type === "video";

  const description = [
    `Consultation with ${doctor}.`,
    isVideo
      ? "This is a video consultation. Open Niramoy shortly before the time to join — the room opens 15 minutes before."
      : "This is an in-person consultation.",
    appointment.reference ? `Reference: ${appointment.reference}` : "",
    appUrl ? `Manage or cancel: ${appUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Niramoy//Appointments//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escape(appointment.id)}@niramoy`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(appointment.startUtc)}`,
    `DTEND:${stamp(appointment.endUtc)}`,
    fold(`SUMMARY:${escape(`Niramoy — consultation with ${doctor}`)}`),
    fold(`DESCRIPTION:${escape(description)}`),
    fold(
      `LOCATION:${escape(
        isVideo ? "Video consultation (Niramoy)" : appointment.doctor?.facility ?? "Niramoy",
      )}`,
    ),
    "STATUS:CONFIRMED",
    // One reminder, an hour ahead. More than that is someone else's phone
    // buzzing at them about their health in a room with other people in it.
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    fold(`DESCRIPTION:${escape(`Consultation with ${doctor} in one hour`)}`),
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.join("\r\n")}\r\n`;
}

/** Hand the file to the browser. No network call, no server-side record. */
export function downloadAppointmentIcs(appointment, options = {}) {
  const blob = new Blob([appointmentToIcs(appointment, options)], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `niramoy-${appointment.reference ?? appointment.id}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
