"use client";

import { useEffect, useState } from "react";
import { Icon } from "../icons.js";
import {
  ActionMenu, Avatar, PageHeading, Empty, Loading, Modal, Field,
  StatusPill, Rating, Banner, Tabs, TabPanel,
} from "../ui.js";
import { downloadAppointmentIcs } from "../../lib/calendar.js";
import { CancellationPolicy } from "./policy.js";

const TABS = [
  { id: "upcoming", label: "Upcoming", match: (a) => ["confirmed", "pending"].includes(a.status) },
  { id: "past", label: "Past visits", match: (a) => ["completed", "no_show"].includes(a.status) },
  { id: "cancelled", label: "Cancelled", match: (a) => a.status === "cancelled" },
];

/**
 * What has happened to the money, in the patient's terms. Says "sandbox" when
 * it is one — a payment badge that reads as real when nothing was charged is
 * worse than no badge.
 */
function PaymentNote({ payment }) {
  if (!payment) return null;
  if (payment.method === "cash") {
    return <span className="pay-note">Paying at the chamber</span>;
  }
  if (payment.status === "succeeded") {
    return (
      <span className="pay-note paid">
        Paid with bKash{payment.isMock ? " · sandbox" : ""}
      </span>
    );
  }
  if (payment.status === "pending") return <span className="pay-note due">bKash payment due</span>;
  return <span className="pay-note failed">bKash payment {payment.status}</span>;
}

/**
 * The one action this appointment needs next.
 *
 * Ordered by what is blocking: an unpaid consultation needs paying, a
 * confirmed one needs joining, a finished one needs a review. Everything else
 * on the card is available, just not competing.
 */
function primaryAction(a, { onPay, onJoinCall, setReviewing, onNavigate }) {
  if (a.status === "confirmed") {
    if (a.payment?.method === "bkash" && a.payment.status === "pending") {
      return { label: "Pay with bKash", tone: "primary", onClick: () => onPay?.(a) };
    }
    return {
      label: "Join call",
      icon: "video",
      tone: "primary",
      onClick: () => onJoinCall(a),
    };
  }
  if (a.status === "completed") {
    return {
      label: "Leave review",
      icon: "star",
      tone: "secondary",
      onClick: () => setReviewing(a),
    };
  }
  if (a.status === "cancelled" || a.status === "no_show") {
    return { label: "Book again", tone: "secondary", onClick: () => onNavigate("doctors") };
  }
  return null;
}

/** Everything else, in the menu. */
function secondaryActions(a, {
  onPay, onJoinCall, onReschedule, onNavigate, setCancelling, setReviewing, setPolicyFor,
}) {
  const calendar = {
    label: "Add to calendar",
    icon: "calendar",
    onClick: () => downloadAppointmentIcs(a, { appUrl: window.location.origin }),
  };
  const policy = {
    label: "Cancellation policy",
    icon: "shield",
    onClick: () => setPolicyFor(a),
  };

  if (a.status === "confirmed") {
    const unpaid = a.payment?.method === "bkash" && a.payment.status === "pending";
    return [
      // Whichever of pay/join is not the primary action stays reachable here.
      unpaid
        ? { label: "Join call", icon: "video", onClick: () => onJoinCall(a) }
        : a.payment?.status === "pending"
          ? { label: "Pay now", icon: "send", onClick: () => onPay?.(a) }
          : null,
      calendar,
      { label: "Reschedule", icon: "clock", onClick: () => onReschedule(a) },
      policy,
      {
        label: "Cancel appointment",
        icon: "x",
        danger: true,
        disabled: !a.canCancel,
        disabledHint: "within the last hour",
        onClick: () => setCancelling(a),
      },
    ];
  }

  if (a.status === "completed") {
    return [
      { label: "View notes", icon: "file", onClick: () => onNavigate("records") },
      { label: "Leave review", icon: "star", onClick: () => setReviewing(a) },
      { label: "Book again", icon: "calendar", onClick: () => onNavigate("doctors") },
    ];
  }

  return [policy];
}

export function Appointments({
  loading, appointments, waitlist, onNavigate, onCancel, onReschedule,
  onJoinCall, onReview, onLeaveWaitlist, onPay,
}) {
  const [tab, setTab] = useState("upcoming");
  const [reviewing, setReviewing] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [policyFor, setPolicyFor] = useState(null);

  const shown = appointments.filter(TABS.find((t) => t.id === tab).match);

  return (
    <>
      <PageHeading
        title="My appointments"
        subtitle="Consultations, follow-ups and everything you've booked."
        actions={
          <button className="button primary" onClick={() => onNavigate("doctors")}>
            <Icon name="plus" size={14} />Book appointment
          </button>
        }
      />

      {waitlist.length > 0 && (
        <div className="section-card card">
          <h3 className="waitlist-head">
            <Icon name="bell" size={15} /> You&apos;re on {waitlist.length} waitlist
            {waitlist.length === 1 ? "" : "s"}
          </h3>
          {waitlist.map((w) => (
            <div className="appointment-row" key={w.id}>
              <Avatar person={w.doctor} size="sm" />
              <div className="appt-main">
                <strong>{w.doctor?.name}</strong>
                <span>Waiting for a slot on {w.dateKey}</span>
              </div>
              <button className="button ghost small" onClick={() => onLeaveWaitlist(w.id)}>
                Leave
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card tabs-card">
        <Tabs
          idPrefix="appointments"
          value={tab}
          onChange={setTab}
          tabs={TABS.map((t) => ({
            id: t.id,
            label: t.label,
            count: appointments.filter(t.match).length,
          }))}
        />

        <TabPanel idPrefix="appointments" id={tab}>
        {loading ? (
          <Loading rows={3} />
        ) : shown.length ? (
          shown.map((a) => (
            <div className="appointment-card card" key={a.id}>
              <div className="appt-date">
                <strong>{a.date}</strong>
                <span>{a.day}</span>
                <em>{a.month}</em>
              </div>

              <Avatar person={a.doctor} />

              <div className="appt-main">
                <strong>{a.doctor?.name}</strong>
                <span>{a.doctor?.specialty} · {a.type}</span>
                {a.reason && <span className="appt-reason">“{a.reason}”</span>}
                <div style={{ marginTop: 8 }}>
                  <StatusPill status={a.status} />
                  <PaymentNote payment={a.payment} />
                </div>
              </div>

              <div className="appt-time">
                <strong>{a.time}</strong>
                <span>{a.day}, {a.date} {a.month}</span>
                {/* Which clock. Obvious to a patient in Dhaka, not at all
                    obvious to a son booking from Jeddah for his mother. */}
                <span className="appt-tz">{a.timezoneLabel ?? "Bangladesh time"}</span>
                <em>{a.doctor?.feeLabel}</em>
              </div>

              <div className="appt-actions">
                {/*
                  * One primary action, chosen by what this appointment needs
                  * next; everything else behind the menu. Six equal buttons
                  * made the patient read all six to find the one they came
                  * for, and put Cancel as close to the thumb as Join.
                  */}
                {(() => {
                  const primary = primaryAction(a, { onPay, onJoinCall, setReviewing, onNavigate });
                  return primary ? (
                    <button className={`button ${primary.tone} small`} onClick={primary.onClick}>
                      {primary.icon && <Icon name={primary.icon} size={12} />}
                      {primary.label}
                    </button>
                  ) : null;
                })()}

                <ActionMenu
                  label={`More actions for ${a.doctor?.name ?? "this appointment"}`}
                  items={secondaryActions(a, {
                    onPay, onJoinCall, onReschedule, onNavigate,
                    setCancelling, setReviewing, setPolicyFor,
                  })}
                />
                {a.status === "cancelled" && (
                  <button className="button ghost small" onClick={() => onNavigate("doctors")}>
                    Book again
                  </button>
                )}
              </div>
            </div>
          ))
        ) : (
          <Empty
            icon="calendar"
            title={`No ${tab} appointments`}
            hint={tab === "upcoming" ? "Book a consultation and it will show up here." : "Nothing in this view yet."}
            action={
              tab === "upcoming" ? (
                <button className="button primary small" onClick={() => onNavigate("doctors")}>
                  Find a doctor
                </button>
              ) : null
            }
          />
        )}
        </TabPanel>
      </div>

      <ReviewModal
        appointment={reviewing}
        onClose={() => setReviewing(null)}
        onSubmit={async (payload) => {
          await onReview(payload);
          setReviewing(null);
        }}
      />

      <Modal
        open={Boolean(policyFor)}
        title="Cancelling, missing and refunds"
        onClose={() => setPolicyFor(null)}
      >
        <CancellationPolicy appointment={policyFor} compact />
      </Modal>

      <Modal
        open={Boolean(cancelling)}
        title="Cancel this appointment?"
        onClose={() => setCancelling(null)}
        footer={
          <>
            <button className="button ghost" onClick={() => setCancelling(null)}>Keep it</button>
            <button
              className="button primary danger"
              onClick={async () => {
                await onCancel(cancelling.id);
                setCancelling(null);
              }}
            >
              Yes, cancel
            </button>
          </>
        }
      >
        <p>
          Your consultation with <strong>{cancelling?.doctor?.name}</strong> on{" "}
          <strong>{cancelling?.day}, {cancelling?.date} {cancelling?.month} at {cancelling?.time}</strong>{" "}
          will be released.
        </p>
        <p className="muted-note">
          The slot goes back into the doctor&apos;s calendar, and anyone waiting for that day is notified.
        </p>
      </Modal>
    </>
  );
}

function ReviewModal({ appointment, onClose, onSubmit }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (appointment) { setRating(5); setComment(""); }
  }, [appointment]);

  if (!appointment) return null;

  return (
    <Modal
      open
      title={`Review your visit with ${appointment.doctor?.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="button ghost" onClick={onClose}>Not now</button>
          <button
            className="button primary"
            onClick={() =>
              onSubmit({
                appointmentId: appointment.id,
                doctorId: appointment.doctorId,
                rating,
                comment,
              })
            }
          >
            Submit review
          </button>
        </>
      }
    >
      <Field label="How was your consultation?">
        <div className="star-picker">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              className={`star-button ${n <= rating ? "on" : ""}`}
              onClick={() => setRating(n)}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
            >
              <Icon name="star" size={22} strokeWidth={n <= rating ? 0 : 1.6} style={n <= rating ? { fill: "currentColor" } : undefined} />
            </button>
          ))}
        </div>
      </Field>

      <Field label="Anything you'd like to add?" hint="Optional. Visible to other patients.">
        <textarea
          className="field textarea"
          rows={4}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Was the doctor clear? Did the call run on time?"
        />
      </Field>
    </Modal>
  );
}

/** "Nabila Begum" -> "NB". Falls back to a neutral placeholder. */
function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "PT";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function Consultation({ appointment, onNavigate, onComplete }) {
  /** The server-issued join grant. Present once the room has been opened. */
  const call = appointment?.call;
  const [elapsed, setElapsed] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  /**
   * Whichever of the two people on the appointment is not you. The doctor sees
   * the patient here and the patient sees the doctor, so this one screen serves
   * both sides of the consultation.
   */
  const viewerIsDoctor = call?.role === "doctor";
  const doctor = appointment?.doctor;
  const peer = viewerIsDoctor
    ? { name: appointment?.patientName || "Your patient", initials: initialsOf(appointment?.patientName), avatar: "sand", subtitle: appointment?.reason || "Patient" }
    : { name: doctor?.name || "Your doctor", initials: doctor?.initials || "DR", avatar: doctor?.avatar || "teal", subtitle: doctor?.specialty };

  /** A provider that carries media gives us a URL we can frame. */
  const embedUrl = call?.embedUrl || null;

  return (
    <>
      <PageHeading
        title="Video consultation"
        subtitle={viewerIsDoctor ? `Consultation with ${peer.name}.` : "Your secure consultation room."}
        actions={
          <button className="button ghost" onClick={() => onNavigate("appointments")}>
            Leave room
          </button>
        }
      />

      <div className="card consult-shell">
        <div className={`consult-stage${embedUrl ? " embedded" : ""}`}>
          <div className="consult-status">
            <span className="live-dot" /> Secure room · {mmss}
          </div>

          {embedUrl ? (
            /*
             * The call itself. Camera and microphone are granted to this frame
             * only, and the URL carries the short-lived join grant — it is not
             * a bookmarkable room. The provider draws its own controls, so we
             * do not draw a second, fake set beside them.
             */
            <iframe
              className="consult-frame"
              title={`Video consultation with ${peer.name}`}
              src={embedUrl}
              allow="camera; microphone; fullscreen; display-capture; autoplay; speaker-selection"
              allowFullScreen
            />
          ) : (
            <div className="consult-peer">
              <div className={`avatar ${peer.avatar}`} style={{ width: 76, height: 76, fontSize: 21, margin: "0 auto 14px" }}>
                {peer.initials}
              </div>
              <strong>{peer.name}</strong>
              <span>{peer.subtitle}</span>
              <p className="consult-hint">
                No video provider is configured, so this is a demo room — the
                access token is real and scoped to you, but no media is carried.
                Set VIDEO_PROVIDER=jitsi to hold a real two-way call.
              </p>
            </div>
          )}

          {!embedUrl && <div className="consult-self">You</div>}

          <div className="consult-controls">
            {!embedUrl && (
              <>
                <button
                  className={`consult-button ${micOn ? "" : "off"}`}
                  onClick={() => setMicOn((v) => !v)}
                  aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
                >
                  <Icon name="mic" size={17} />
                </button>
                <button
                  className={`consult-button ${camOn ? "" : "off"}`}
                  onClick={() => setCamOn((v) => !v)}
                  aria-label={camOn ? "Turn camera off" : "Turn camera on"}
                >
                  <Icon name="video" size={17} />
                </button>
              </>
            )}
            <button
              className="button leave-button"
              onClick={async () => {
                if (appointment) await onComplete(appointment.id);
                onNavigate("appointments");
              }}
            >
              End consultation
            </button>
          </div>
        </div>

        <div className="consult-footer">
          <span>
            {embedUrl
              ? `Connected via ${call.provider} · not recorded${call.provider === "jitsi-public" ? " · public room, unlisted" : ""}`
              : "Recording is off · This conversation is private and encrypted."}
          </span>
          <button className="button secondary small" onClick={() => onNavigate("records")}>
            <Icon name="file" size={12} />View medical history
          </button>
        </div>
      </div>

      <Banner tone="info" icon="info" title="What happens next">
        When the doctor ends the consultation they can generate an AI visit summary and a
        prescription draft, review it, and publish it to your records.
      </Banner>
    </>
  );
}
