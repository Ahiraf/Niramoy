"use client";

/**
 * What happens next.
 *
 * Booking used to end by dropping the patient on the appointments list with a
 * toast. That answers "did it work" and none of the questions people actually
 * have at that moment: when do I join, what if I can't make it, will I be
 * reminded, and is my money at risk. Each of those is answered here, once,
 * where it is being asked.
 */

import { Icon } from "../icons.js";
import { Banner, PageHeading } from "../ui.js";
import { downloadAppointmentIcs } from "../../lib/calendar.js";
import { CancellationPolicy } from "./policy.js";

export function Booked({ appointment, onNavigate, onOpenSettings }) {
  if (!appointment) return null;

  const isVideo = appointment.type === "video";
  const doctor = appointment.doctor?.name ?? "your doctor";

  const steps = [
    {
      icon: "bell",
      title: "We'll remind you",
      body: "A reminder arrives a day before and again an hour before. In-app always; by email too if you have that switched on.",
      action: { label: "Reminder settings", onClick: onOpenSettings },
    },
    isVideo
      ? {
          icon: "video",
          title: "Join from your appointments",
          body: "The consultation room opens 15 minutes before the start time. Open Niramoy and press Join call — there is no link to lose.",
        }
      : {
          icon: "pin",
          title: "Go to the chamber",
          body: `${appointment.doctor?.facility ?? "The doctor's chamber"} — arrive a few minutes early.`,
        },
    {
      icon: "file",
      title: "Afterwards",
      body: "Your prescription and visit summary are saved to your records. The doctor reviews and approves both before you see them.",
      action: { label: "View records", onClick: () => onNavigate("records") },
    },
  ];

  return (
    <>
      <PageHeading
        title="You're booked"
        subtitle={`${doctor} · ${appointment.day}, ${appointment.date} ${appointment.month} at ${appointment.time}`}
      />

      <div className="card booked-card">
        <div className="booked-head">
          <div className="booked-tick"><Icon name="check" size={22} /></div>
          <div>
            <strong>
              {appointment.day}, {appointment.date} {appointment.month} · {appointment.time}
            </strong>
            {/* The zone, spelled out. The same string means different instants
                to a patient in Dhaka and a relative booking from abroad. */}
            <span>
              {appointment.timezoneLabel ?? "Bangladesh time"} · {appointment.durationMinutes} minutes
              {appointment.reference ? ` · ${appointment.reference}` : ""}
            </span>
          </div>
          <button
            className="button secondary small"
            onClick={() => downloadAppointmentIcs(appointment, { appUrl: window.location.origin })}
          >
            <Icon name="calendar" size={13} /> Add to calendar
          </button>
        </div>

        <ol className="booked-steps">
          {steps.map((step) => (
            <li key={step.title}>
              <div className="booked-step-icon"><Icon name={step.icon} size={15} /></div>
              <div>
                <strong>{step.title}</strong>
                <p>{step.body}</p>
                {step.action && (
                  <button className="text-link" onClick={step.action.onClick}>
                    {step.action.label}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>

        <CancellationPolicy appointment={appointment} />

        <div className="booked-actions">
          <button className="button primary" onClick={() => onNavigate("appointments")}>
            Go to my appointments <Icon name="arrow" size={14} />
          </button>
          <button className="button ghost" onClick={() => onNavigate("doctors")}>
            Book another
          </button>
        </div>
      </div>

      <Banner tone="info" icon="info" title="Not sure this is the right doctor?">
        You can cancel free of charge up to an hour before the consultation, and
        book someone else. Nothing is charged until then.
      </Banner>
    </>
  );
}
