"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons.js";
import {
  Avatar, PageHeading, Empty, Loading, VerifiedBadge, Field, Select, Banner,
} from "../ui.js";

const PERIODS = ["Morning", "Afternoon", "Evening"];

const PAYMENT_METHODS = [
  { value: "bkash", label: "bKash", hint: "Confirm in the wallet you already use." },
  { value: "cash", label: "Pay at the chamber", hint: "Settle in person on the day." },
];

export function Booking({ doctor, family, onConfirm, onBack, onJoinWaitlist, api, notify }) {
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [forMember, setForMember] = useState("");
  const [reason, setReason] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bkash");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const data = await api.slots(doctor.id, 21);
      if (cancelled) return;
      setDays(data.days ?? []);
      setSelectedDay(0);
      setSelectedSlot(data.days?.[0]?.slots?.[0] ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [doctor.id, api]);

  const day = days[selectedDay];

  const grouped = useMemo(() => {
    const out = {};
    for (const period of PERIODS) {
      const slots = (day?.slots ?? []).filter((s) => s.period === period);
      if (slots.length) out[period] = slots;
    }
    return out;
  }, [day]);

  const confirm = async () => {
    if (!selectedSlot) return;
    setSubmitting(true);
    const result = await onConfirm({
      doctorId: doctor.id,
      startUtc: selectedSlot.startUtc,
      forMember: forMember || null,
      reason,
      paymentMethod,
    });
    setSubmitting(false);

    // A 409 means someone took the slot between render and submit — refresh.
    if (!result.ok && ["slot_taken", "slot_unavailable"].includes(result.reason)) {
      const data = await api.slots(doctor.id, 21);
      setDays(data.days ?? []);
      setSelectedSlot(null);
    }
  };

  return (
    <>
      <PageHeading
        title="Book an appointment"
        subtitle="Times shown are Bangladesh Standard Time. Slots are checked for conflicts when you confirm."
        back={{ label: `Back to ${doctor.name}`, onClick: onBack }}
      />

      <div className="booking-layout">
        <section className="profile-card card">
          <div className="profile-intro">
            <Avatar person={doctor} size="lg" />
            <div>
              <h2>{doctor.name}</h2>
              <p>{doctor.specialty} · {doctor.facility}</p>
              <VerifiedBadge doctor={doctor} />
            </div>
          </div>

          {loading ? (
            <Loading rows={2} label="Loading available times" />
          ) : days.length === 0 ? (
            <Empty
              icon="calendar"
              title="Fully booked for the next three weeks"
              hint="Join the waitlist and we'll notify you the moment a slot frees up."
              action={
                <button className="button primary small" onClick={() => onJoinWaitlist(doctor)}>
                  <Icon name="bell" size={13} /> Join waitlist
                </button>
              }
            />
          ) : (
            <>
              <div className="booking-section">
                <h3>Select a date</h3>
                <div className="date-row">
                  {days.map((d, i) => (
                    <button
                      key={d.dateKey}
                      className={`date-option ${selectedDay === i ? "selected" : ""}`}
                      onClick={() => {
                        setSelectedDay(i);
                        setSelectedSlot(days[i].slots[0] ?? null);
                      }}
                    >
                      <span>{d.day}</span>
                      <strong>{d.date}</strong>
                      <em>{d.month}</em>
                      <i className="slot-count">{d.slots.length}</i>
                    </button>
                  ))}
                </div>
              </div>

              <div className="booking-section">
                <h3>
                  Available times
                  <span className="section-note">· {day?.day}, {day?.date} {day?.month}</span>
                </h3>
                {Object.entries(grouped).map(([period, slots]) => (
                  <div className="slot-group" key={period}>
                    <span className="slot-label">{period}</span>
                    <div className="slot-grid">
                      {slots.map((s) => (
                        <button
                          key={s.startUtc}
                          className={`slot ${selectedSlot?.startUtc === s.startUtc ? "selected" : ""}`}
                          onClick={() => setSelectedSlot(s)}
                        >
                          {s.localLabel}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="booking-section">
                <h3>Consultation details</h3>
                <Field label="Who is this appointment for?">
                  <Select
                    value={forMember}
                    onChange={setForMember}
                    options={[
                      { value: "", label: "Myself (Nabila Begum)" },
                      ...family.map((m) => ({ value: m.id, label: `${m.name} · ${m.relation}` })),
                    ]}
                  />
                </Field>
                <Field
                  label="What would you like to discuss?"
                  hint="Optional, but it helps the doctor prepare."
                >
                  <textarea
                    className="field textarea"
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Recurring headaches for the past three weeks"
                  />
                </Field>
              </div>
            </>
          )}
        </section>

        <aside className="booking-side card">
          <h3>Appointment summary</h3>

          <div className="summary-doctor">
            <Avatar person={doctor} size="sm" />
            <div className="doctor-detail">
              <strong>{doctor.name}</strong>
              <span>{doctor.specialty}</span>
            </div>
          </div>

          <div className="summary-line">
            <span>Date</span>
            <strong>{selectedSlot ? `${selectedSlot.day}, ${selectedSlot.date} ${selectedSlot.month}` : "—"}</strong>
          </div>
          <div className="summary-line">
            <span>Time</span>
            <strong>{selectedSlot?.localLabel ?? "—"}</strong>
          </div>
          <div className="summary-line">
            <span>Consultation</span>
            <strong>Video · {doctor.consultationMinutes} min</strong>
          </div>
          <div className="summary-total">
            <span>Total fee</span>
            <strong>{doctor.feeLabel}</strong>
          </div>

          <button
            className="button primary"
            style={{ width: "100%" }}
            disabled={!selectedSlot || submitting}
            onClick={confirm}
          >
            {submitting ? "Confirming…" : "Confirm appointment"}
            {!submitting && <Icon name="arrow" size={14} />}
          </button>

          {!selectedSlot && !loading && days.length > 0 && (
            <p className="field-hint" style={{ textAlign: "center", marginTop: 8 }}>
              Pick a time to continue.
            </p>
          )}

          <div className="pay-method">
            <h4>How would you like to pay?</h4>
            {PAYMENT_METHODS.map((option) => (
              <label
                key={option.value}
                className={`pay-option ${paymentMethod === option.value ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="payment-method"
                  value={option.value}
                  checked={paymentMethod === option.value}
                  onChange={() => setPaymentMethod(option.value)}
                />
                <span className="pay-option-body">
                  <strong>{option.label}</strong>
                  <em>{option.hint}</em>
                </span>
                {option.value === "bkash" && <span className="bkash-mark small">bKash</span>}
              </label>
            ))}
          </div>

          <Banner tone="info" icon="info">
            Payments run against a sandbox for this MVP — nothing is charged, and
            Niramoy never asks for your bKash PIN.
          </Banner>

          <div className="secure-note">
            <Icon name="shield" size={15} />
            <span>
              Your slot is validated against the doctor&apos;s live availability at the moment you
              confirm, so two patients can never hold the same time. Cancel up to an hour before.
            </span>
          </div>
        </aside>
      </div>
    </>
  );
}
