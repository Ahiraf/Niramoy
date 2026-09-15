"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons.js";
import {
  Avatar, PageHeading, SectionHead, Stat, Empty, Loading, Modal, Field, Select,
  StatusPill, Banner,
} from "./ui.js";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The signed-in doctor for the demo. Real build: the NextAuth session user. */
/**
 * The signed-in doctor's own published profile.
 *
 * A verified account carries the id of the profile an admin published for it.
 * An account without one has NO profile, and this returns null to say so.
 *
 * It used to fall back to `api.doctors({ specialty: "Cardiology", perPage: 1 })`
 * — the first cardiologist in the directory — so a doctor who had not been
 * verified opened their dashboard and was shown a stranger's name, facility,
 * fee and 150 reviews under the heading "Your profile". An empty workspace is
 * an inconvenience; another person's credentials presented as yours is a
 * different kind of thing entirely, and on a clinical directory it is the kind
 * that ends up in front of a patient.
 */
export function useDoctorSelf(user, api, revision = 0) {
  const [self, setSelf] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.doctorId) {
        if (!cancelled) setSelf(null);
        return;
      }
      const [data, schedule] = await Promise.all([
        api.doctor(user.doctorId),
        api.doctorAvailability(),
      ]);
      if (!cancelled) {
        setSelf(data.ok ? { ...data.doctor, availability: schedule.availability ?? [] } : null);
      }
    })();
    return () => { cancelled = true; };
  }, [api, user?.doctorId, revision]);
  return self;
}

/**
 * "Fariha Rayhan Mim" -> "FM".
 *
 * The name comes from the appointment row — a doctor's list must show who is
 * actually booked. It used to render the seed patient for every row, which on
 * a clinic screen is worse than showing nothing: it looks like real data.
 */
function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "PT";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function DoctorWorkspace({ active, self, appointments, loading, onNavigate, onJoinCall, onIssuePrescription, api, notify }) {
  if (active === "availability") return <Availability self={self} api={api} notify={notify} />;
  if (active === "earnings") return <Earnings self={self} appointments={appointments} />;
  if (active === "doctor-schedule") {
    return (
      <Schedule
        self={self} appointments={appointments} loading={loading}
        onJoinCall={onJoinCall} onIssuePrescription={onIssuePrescription}
        api={api} notify={notify} onNavigate={onNavigate}
      />
    );
  }
  return <DoctorHome self={self} appointments={appointments} loading={loading} onNavigate={onNavigate} onJoinCall={onJoinCall} />;
}

function DoctorHome({ self, appointments, loading, onNavigate, onJoinCall }) {
  const upcoming = appointments.filter((a) => ["confirmed", "pending"].includes(a.status));
  const completed = appointments.filter((a) => a.status === "completed");
  const earnings = completed.reduce((sum, a) => sum + (a.fee ?? 0), 0);

  return (
    <>
      <PageHeading
        title={`Good morning, ${self ? self.name.replace(/^Dr\.\s*/, "Dr. ").split(" ").slice(0, 2).join(" ") : "Doctor"}`}
        subtitle={`${upcoming.length} upcoming consultation${upcoming.length === 1 ? "" : "s"} on your schedule.`}
        actions={
          <button className="button primary" onClick={() => onNavigate("doctor-schedule")}>
            <Icon name="calendar" size={14} />View schedule
          </button>
        }
      />

      <div className="doctor-dashboard">
        <div className="earnings-card card">
          <div>
            <small>Earnings from completed consultations</small>
            <h2>৳ {earnings.toLocaleString("en-BD")}</h2>
            <p>{completed.length} completed visit{completed.length === 1 ? "" : "s"}</p>
          </div>
          <div className="mini-chart">
            <svg viewBox="0 0 230 70" fill="none" aria-hidden="true">
              <path d="M0 58 C18 53, 24 56, 38 45 S59 52, 74 39 S95 43, 110 29 S135 38, 148 21 S171 28, 184 18 S207 23, 230 5" stroke="#c7eee5" strokeWidth="2" />
            </svg>
          </div>
        </div>

        <div className="stat-grid">
          <Stat icon="calendar" label="Upcoming" value={String(upcoming.length).padStart(2, "0")} trend="Confirmed bookings" />
          <Stat icon="check" tone="blue" label="Completed" value={String(completed.length).padStart(2, "0")} trend="All time" />
          <Stat icon="star" tone="purple" label="Rating" value={self ? self.rating.toFixed(1) : "—"} trend={self ? `${self.ratingCount} reviews` : ""} />
          <Stat icon="clock" tone="orange" label="Weekly hours" value={self ? `${weeklyHours(self)}h` : "—"} trend="Published availability" />
        </div>

        <div className="doctor-content-grid">
          <section className="section-card card">
            <SectionHead
              title="Next appointments"
              action={<button className="text-link" onClick={() => onNavigate("doctor-schedule")}>View schedule</button>}
            />
            {loading ? <Loading /> : upcoming.length ? (
              upcoming.slice(0, 5).map((a) => (
                <div className="appointment-row" key={a.id}>
                  <div className="date-chip"><strong>{a.time.slice(0, 5)}</strong><span>{a.time.slice(-2)}</span></div>
                  <div className="avatar md tan">{initialsOf(a.patientName)}</div>
                  <div className="appt-main">
                    <strong>{a.patientName ?? "Patient"}</strong>
                    <span>{a.day}, {a.date} {a.month} · {a.reason || "Video consultation"}</span>
                  </div>
                  <button className="button primary small" onClick={() => onJoinCall(a)}>
                    <Icon name="video" size={12} />Open room
                  </button>
                </div>
              ))
            ) : (
              <Empty icon="calendar" title="No appointments booked" hint="Patients will appear here once they book one of your slots." />
            )}
          </section>

          <section className="section-card card">
            <SectionHead title="Your profile" />
            {self ? (
              <>
                <div className="profile-intro">
                  <Avatar person={self} size="lg" />
                  <div>
                    <h2 style={{ fontSize: 15 }}>{self.name}</h2>
                    <p>{self.degrees}</p>
                  </div>
                </div>
                <div className="summary-line"><span>Specialty</span><strong>{self.specialty}</strong></div>
                <div className="summary-line"><span>Facility</span><strong>{self.facility}</strong></div>
                <div className="summary-line"><span>Fee</span><strong>{self.feeLabel}</strong></div>
                <div className="summary-line"><span>BM&amp;DC</span><strong>{self.bmdcNumber}</strong></div>
              </>
            ) : <Loading rows={2} />}
          </section>
        </div>
      </div>
    </>
  );
}

function weeklyHours(doctor) {
  return (doctor.availability ?? []).reduce((sum, r) => {
    const [sh] = r.localStart.split(":").map(Number);
    const [eh] = r.localEnd.split(":").map(Number);
    return sum + (eh - sh);
  }, 0);
}

function Schedule({ self, appointments, loading, onJoinCall, onIssuePrescription, api, notify }) {
  const [writing, setWriting] = useState(null);
  const upcoming = appointments.filter((a) => ["confirmed", "pending"].includes(a.status));
  const past = appointments.filter((a) => a.status === "completed");

  return (
    <>
      <PageHeading
        title="Your appointments"
        subtitle={`${upcoming.length} upcoming · ${past.length} completed`}
      />

      <div className="card section-card">
        <SectionHead title="Upcoming" />
        {loading ? <Loading /> : upcoming.length ? upcoming.map((a) => (
          <div className="appointment-row" key={a.id}>
            <div className="date-chip"><strong>{a.date}</strong><span>{a.month}</span></div>
            <div className="avatar md tan">{initialsOf(a.patientName)}</div>
            <div className="appt-main">
              <strong>{a.patientName ?? "Patient"}</strong>
              <span>{a.day}, {a.date} {a.month} at {a.time}</span>
              {a.reason && <span className="appt-reason">“{a.reason}”</span>}
            </div>
            <StatusPill status={a.status} />
            <button className="button primary small" onClick={() => onJoinCall(a)}>
              <Icon name="video" size={12} />Open room
            </button>
          </div>
        )) : <Empty icon="calendar" title="Nothing booked" />}
      </div>

      <div className="card section-card">
        <SectionHead title="Completed — awaiting notes" />
        {past.length ? past.map((a) => (
          <div className="appointment-row" key={a.id}>
            <div className="date-chip"><strong>{a.date}</strong><span>{a.month}</span></div>
            <div className="avatar md tan">{initialsOf(a.patientName)}</div>
            <div className="appt-main">
              <strong>{a.patientName ?? "Patient"}</strong>
              <span>{a.reason || "Video consultation"}</span>
            </div>
            <button className="button secondary small" onClick={() => setWriting(a)}>
              <Icon name="file" size={12} />Write prescription
            </button>
          </div>
        )) : <Empty icon="file" title="No completed visits yet" />}
      </div>

      <PrescriptionWriter
        appointment={writing}
        self={self}
        api={api}
        notify={notify}
        onClose={() => setWriting(null)}
        onSubmit={async (payload) => {
          await onIssuePrescription(payload);
          setWriting(null);
          notify?.("Prescription published to the patient's records");
        }}
      />
    </>
  );
}

/**
 * Prescription form with an AI-drafted visit summary. The draft is always
 * marked for review — the doctor edits and confirms before anything is saved.
 */
function PrescriptionWriter({ appointment, self, api, onClose, onSubmit, notify }) {
  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");
  const [transcript, setTranscript] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [drafting, setDrafting] = useState(false);
  /** The AI draft awaiting this doctor's confirmation, if one was generated. */
  const [summaryId, setSummaryId] = useState(null);
  const [items, setItems] = useState([{ drug: "", dose: "", frequency: "", duration: "" }]);

  useEffect(() => {
    if (appointment) {
      setDiagnosis(""); setNotes(""); setAiSummary("");
      setTranscript(appointment.reason ?? "");
      setSummaryId(null);
      setItems([{ drug: "", dose: "", frequency: "", duration: "" }]);
    }
  }, [appointment]);

  if (!appointment) return null;

  const draft = async () => {
    setDrafting(true);
    // The patient is derived from the appointment server-side; sending a name
    // from here would just be a second, less reliable source of truth.
    const data = await api.summary({ appointmentId: appointment.id, transcript });
    setDrafting(false);
    if (data.ok) {
      // Held so the doctor's confirmation can be attributed to this exact
      // draft — which model and prompt produced it, and what they changed.
      setSummaryId(data.id);
      setAiSummary(data.draft.summary ?? "");
      if (data.draft.diagnosis) setDiagnosis(data.draft.diagnosis);
      if (data.draft.advice) setNotes(data.draft.advice);
    } else {
      notify?.(data.message ?? "Couldn't draft a summary.", "error");
    }
  };

  const setItem = (i, key, value) =>
    setItems((list) => list.map((it, idx) => (idx === i ? { ...it, [key]: value } : it)));

  return (
    <Modal
      open wide title="Write prescription" onClose={onClose}
      footer={
        <>
          <button className="button ghost" onClick={onClose}>Cancel</button>
          <button
            className="button primary"
            disabled={!items.some((i) => i.drug.trim())}
            onClick={() =>
              onSubmit({
                appointmentId: appointment.id,
                doctorId: appointment.doctorId,
                diagnosis, notes, aiSummary,
                // Present only when a draft was generated. Confirming the
                // prescription is what publishes the reviewed summary.
                summaryId,
                items: items.filter((i) => i.drug.trim()),
              })
            }
          >
            Publish to patient
          </button>
        </>
      }
    >
      <Field label="Consultation notes" hint="What you discussed. Used to draft the AI summary.">
        <textarea className="field textarea" rows={3} value={transcript} onChange={(e) => setTranscript(e.target.value)} />
      </Field>

      <button className="button secondary small" onClick={draft} disabled={drafting || !transcript.trim()}>
        <Icon name="bot" size={13} />{drafting ? "Drafting…" : "Draft summary with AI"}
      </button>

      {aiSummary && (
        <div className="ai-draft">
          <span className="rx-label"><Icon name="bot" size={12} /> AI draft — review before publishing</span>
          <textarea className="field textarea" rows={4} value={aiSummary} onChange={(e) => setAiSummary(e.target.value)} />
        </div>
      )}

      <Field label="Diagnosis">
        <input className="field" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="e.g. Tension-type headache" />
      </Field>

      <Field label="Medicines">
        <div className="rx-editor">
          {items.map((it, i) => (
            <div className="rx-editor-row" key={i}>
              <input className="field" placeholder="Medicine" value={it.drug} onChange={(e) => setItem(i, "drug", e.target.value)} />
              <input className="field" placeholder="Dose" value={it.dose} onChange={(e) => setItem(i, "dose", e.target.value)} />
              <input className="field" placeholder="Frequency" value={it.frequency} onChange={(e) => setItem(i, "frequency", e.target.value)} />
              <input className="field" placeholder="Duration" value={it.duration} onChange={(e) => setItem(i, "duration", e.target.value)} />
              <button className="icon-button" onClick={() => setItems((l) => l.filter((_, idx) => idx !== i))} aria-label="Remove medicine">
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
        <button className="button ghost small" onClick={() => setItems((l) => [...l, { drug: "", dose: "", frequency: "", duration: "" }])}>
          <Icon name="plus" size={13} />Add medicine
        </button>
      </Field>

      <Field label="Advice">
        <textarea className="field textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <Banner tone="warn" icon="alert">
        You are responsible for what you publish. The AI draft is a starting point and may be
        incomplete or wrong — check every medicine and dose before confirming.
      </Banner>
    </Modal>
  );
}

/** "2026-09-20" for today in the browser's own zone, for the date input's min. */
function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-20" -> { day: "20", month: "Sep", label: "Sunday, 20 Sep 2026" }. */
function describeDateKey(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  // Read back in UTC, because that is how it was built. Constructing a local
  // Date from the parts would shift the day for anyone west of Greenwich.
  const at = new Date(Date.UTC(y, m - 1, d));
  const weekday = WEEKDAYS[at.getUTCDay()];
  return {
    day: String(d),
    month: MONTHS[m - 1],
    label: `${weekday}, ${d} ${MONTHS[m - 1]} ${y}`,
  };
}

const EMPTY_WEEKLY = {
  weekday: "0",
  localStart: "09:00",
  localEnd: "17:00",
  slotMinutes: "20",
  bufferMinutes: "0",
};

const EMPTY_DATED = {
  date: todayKey(),
  kind: "extra",
  localStart: "18:00",
  localEnd: "21:00",
  slotMinutes: "20",
  bufferMinutes: "0",
  reason: "",
};

/**
 * The doctor's schedule: recurring weekly hours, plus what is different about
 * particular dates.
 *
 * The two are kept visually apart because they behave differently — a weekly
 * rule keeps producing slots forever, a dated entry applies once — and a doctor
 * about to go on leave needs to know which one they are editing.
 */
function Availability({ self, api, notify }) {
  const [rules, setRules] = useState(self?.availability ?? []);
  const [exceptions, setExceptions] = useState([]);
  const [adding, setAdding] = useState(null); // null | "weekly" | "dated"
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [weekly, setWeekly] = useState(EMPTY_WEEKLY);
  const [dated, setDated] = useState(EMPTY_DATED);

  useEffect(() => setRules(self?.availability ?? []), [self]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await api.doctorAvailabilityExceptions();
      if (!cancelled && result.ok) setExceptions(result.exceptions ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const openAdd = (which) => {
    setError(null);
    setWeekly(EMPTY_WEEKLY);
    setDated(EMPTY_DATED);
    setAdding(which);
  };

  const addWeekly = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const result = await api.addDoctorAvailability(weekly);
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? "Could not save those hours.");
      return;
    }
    setRules((current) =>
      [...current, result.availability].sort(
        (a, b) => a.weekday - b.weekday || a.localStart.localeCompare(b.localStart),
      ),
    );
    setAdding(null);
    notify?.("Consulting hours added");
  };

  const addDated = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    /*
     * Three shapes collapse into two stored ones: extra hours, a block over a
     * range, and a block over the whole day — which is the one with no window
     * at all. The server decides that from the absence of the times rather
     * than from a flag, so there is one fewer thing the two can disagree on.
     */
    const allDay = dated.kind === "block-all-day";
    const payload = {
      date: dated.date,
      type: dated.kind === "extra" ? "extra" : "block",
      reason: dated.reason,
      ...(allDay
        ? {}
        : { localStart: dated.localStart, localEnd: dated.localEnd }),
      ...(dated.kind === "extra"
        ? { slotMinutes: dated.slotMinutes, bufferMinutes: dated.bufferMinutes }
        : {}),
    };

    const result = await api.addDoctorAvailabilityException(payload);
    setSaving(false);
    if (!result.ok) {
      setError(result.message ?? "Could not save that date.");
      return;
    }
    setExceptions((current) =>
      [...current, result.exception].sort(
        (a, b) => a.date.localeCompare(b.date) || (a.localStart ?? "").localeCompare(b.localStart ?? ""),
      ),
    );
    setAdding(null);
    notify?.(dated.kind === "extra" ? "Extra hours added" : "Time blocked");
  };

  const removeRule = async (rule) => {
    setBusyId(rule.id);
    const result = await api.removeDoctorAvailability(rule.id);
    setBusyId(null);
    if (!result.ok) {
      notify?.(result.message ?? "Could not remove those hours", "error");
      return;
    }
    setRules((current) => current.filter((r) => r.id !== rule.id));
    notify?.("Hours removed. Appointments already booked are unaffected.");
  };

  const removeException = async (entry) => {
    setBusyId(entry.id);
    const result = await api.removeDoctorAvailabilityException(entry.id);
    setBusyId(null);
    if (!result.ok) {
      notify?.(result.message ?? "Could not remove that entry", "error");
      return;
    }
    setExceptions((current) => current.filter((e) => e.id !== entry.id));
    notify?.("Removed");
  };

  const datedIsBlock = dated.kind !== "extra";
  const datedIsAllDay = dated.kind === "block-all-day";

  return (
    <>
      <PageHeading
        title="Availability"
        subtitle="Your recurring hours in Bangladesh Standard Time, and anything different about a particular date. Patients only ever see bookable slots."
        actions={(
          <>
            <button type="button" className="button ghost" onClick={() => openAdd("dated")}>
              <Icon name="calendar" size={14} />Add a date
            </button>
            <button type="button" className="button primary" onClick={() => openAdd("weekly")}>
              <Icon name="plus" size={14} />Add hours
            </button>
          </>
        )}
      />

      <div className="section-card card">
        <SectionHead title="Weekly schedule" action={<span className="status confirmed">Auto-generating slots</span>} />
        {rules.length ? (
          <table className="availability-table">
            <thead>
              <tr><th>Day</th><th>Hours (BST)</th><th>Stored as (UTC)</th><th>Slot</th><th>Bookable</th><th /></tr>
            </thead>
              <tbody>
              {rules.map((r) => {
                const toMinutes = (value) => {
                  const [hours, minutes] = value.split(":").map(Number);
                  return hours * 60 + minutes;
                };
                const sh = toMinutes(r.localStart);
                const eh = toMinutes(r.localEnd);
                const step = r.slotMinutes + (r.bufferMinutes || 0);
                return (
                  <tr key={r.id}>
                    <td>{WEEKDAYS[r.weekday]}</td>
                    <td>{r.localStart} – {r.localEnd}</td>
                    <td className="muted-cell">{r.start} – {r.end}</td>
                    <td>{r.slotMinutes} min{r.bufferMinutes ? ` +${r.bufferMinutes}` : ""}</td>
                    <td><span className="availability-chip">{Math.floor((eh - sh) / step)} slots</span></td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="button ghost small"
                        onClick={() => removeRule(r)}
                        disabled={busyId === r.id}
                      >
                        {busyId === r.id ? "Removing…" : "Remove"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty
            icon="clock"
            title="No recurring hours yet"
            hint="Add the hours you regularly see patients so they can book a consultation."
            action={<button type="button" className="button primary small" onClick={() => openAdd("weekly")}><Icon name="plus" size={13} />Add hours</button>}
          />
        )}
      </div>

      <div className="section-card card">
        <SectionHead
          title="Specific dates"
          action={(
            <button type="button" className="button ghost small" onClick={() => openAdd("dated")}>
              <Icon name="plus" size={13} />Add a date
            </button>
          )}
        />
        {exceptions.length ? (
          exceptions.map((e) => {
            const when = describeDateKey(e.date);
            return (
              <div className="appointment-row" key={e.id}>
                <div className="date-chip"><strong>{when.day}</strong><span>{when.month}</span></div>
                <div className="appt-main">
                  <strong>
                    {e.type === "extra" ? "Extra consulting hours" : e.allDay ? "Unavailable all day" : "Time blocked"}
                  </strong>
                  <span>
                    {when.label} ·{" "}
                    {e.allDay ? "All day" : `${e.localStart} – ${e.localEnd}`}
                    {e.type === "extra" && e.slotMinutes ? ` · ${e.slotMinutes} min slots` : ""}
                  </span>
                  {e.reason && <span className="appt-reason">“{e.reason}”</span>}
                </div>
                <StatusPill status={e.type === "extra" ? "confirmed" : "cancelled"} />
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => removeException(e)}
                  disabled={busyId === e.id}
                >
                  {busyId === e.id ? "Removing…" : "Remove"}
                </button>
              </div>
            );
          })
        ) : (
          <Empty
            icon="calendar"
            title="Nothing different coming up"
            hint="Open extra hours for one date, or block time you are not available."
            action={<button type="button" className="button primary small" onClick={() => openAdd("dated")}><Icon name="plus" size={13} />Add a date</button>}
          />
        )}
      </div>

      <Modal
        open={adding === "weekly"}
        title="Add recurring hours"
        onClose={() => !saving && setAdding(null)}
        footer={(
          <>
            <button type="button" className="button ghost" onClick={() => setAdding(null)} disabled={saving}>Cancel</button>
            <button type="submit" form="availability-form" className="button primary" disabled={saving}>{saving ? "Saving…" : "Save hours"}</button>
          </>
        )}
      >
        <form id="availability-form" onSubmit={addWeekly}>
          <Field label="Day">
            <Select
              value={weekly.weekday}
              onChange={(weekday) => setWeekly((current) => ({ ...current, weekday }))}
              options={WEEKDAYS.map((day, weekday) => ({ value: String(weekday), label: day }))}
            />
          </Field>
          <div className="field-row">
            <Field label="From">
              <input className="field" type="time" value={weekly.localStart} onChange={(event) => setWeekly((current) => ({ ...current, localStart: event.target.value }))} required />
            </Field>
            <Field label="Until">
              <input className="field" type="time" value={weekly.localEnd} onChange={(event) => setWeekly((current) => ({ ...current, localEnd: event.target.value }))} required />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Slot length">
              <Select
                value={weekly.slotMinutes}
                onChange={(slotMinutes) => setWeekly((current) => ({ ...current, slotMinutes }))}
                options={["10", "15", "20", "30", "45", "60"].map((value) => ({ value, label: `${value} minutes` }))}
              />
            </Field>
            <Field label="Buffer between slots" hint="Optional gap after each consultation.">
              <Select
                value={weekly.bufferMinutes}
                onChange={(bufferMinutes) => setWeekly((current) => ({ ...current, bufferMinutes }))}
                options={["0", "5", "10", "15"].map((value) => ({ value, label: `${value} minutes` }))}
              />
            </Field>
          </div>
          {error && <Banner tone="warn" icon="alert">{error}</Banner>}
        </form>
      </Modal>

      <Modal
        open={adding === "dated"}
        title="Add a specific date"
        onClose={() => !saving && setAdding(null)}
        footer={(
          <>
            <button type="button" className="button ghost" onClick={() => setAdding(null)} disabled={saving}>Cancel</button>
            <button type="submit" form="dated-availability-form" className="button primary" disabled={saving}>{saving ? "Saving…" : "Save date"}</button>
          </>
        )}
      >
        <form id="dated-availability-form" onSubmit={addDated}>
          <Field label="What is happening">
            <Select
              value={dated.kind}
              onChange={(kind) => setDated((current) => ({ ...current, kind }))}
              options={[
                { value: "extra", label: "Extra consulting hours" },
                { value: "block-range", label: "Block part of the day" },
                { value: "block-all-day", label: "Unavailable all day" },
              ]}
            />
          </Field>

          <Field label="Date" hint="Today or later.">
            <input
              className="field"
              type="date"
              min={todayKey()}
              value={dated.date}
              onChange={(event) => setDated((current) => ({ ...current, date: event.target.value }))}
              required
            />
          </Field>

          {!datedIsAllDay && (
            <div className="field-row">
              <Field label="From">
                <input className="field" type="time" value={dated.localStart} onChange={(event) => setDated((current) => ({ ...current, localStart: event.target.value }))} required />
              </Field>
              <Field label="Until">
                <input className="field" type="time" value={dated.localEnd} onChange={(event) => setDated((current) => ({ ...current, localEnd: event.target.value }))} required />
              </Field>
            </div>
          )}

          {!datedIsBlock && (
            <div className="field-row">
              <Field label="Slot length">
                <Select
                  value={dated.slotMinutes}
                  onChange={(slotMinutes) => setDated((current) => ({ ...current, slotMinutes }))}
                  options={["10", "15", "20", "30", "45", "60"].map((value) => ({ value, label: `${value} minutes` }))}
                />
              </Field>
              <Field label="Buffer between slots">
                <Select
                  value={dated.bufferMinutes}
                  onChange={(bufferMinutes) => setDated((current) => ({ ...current, bufferMinutes }))}
                  options={["0", "5", "10", "15"].map((value) => ({ value, label: `${value} minutes` }))}
                />
              </Field>
            </div>
          )}

          <Field label="Note" hint="Optional. Only you see this.">
            <input
              className="field"
              type="text"
              maxLength={200}
              placeholder={datedIsBlock ? "Hospital round" : "Evening clinic"}
              value={dated.reason}
              onChange={(event) => setDated((current) => ({ ...current, reason: event.target.value }))}
            />
          </Field>

          {datedIsBlock ? (
            <Banner tone="info" icon="info">
              Blocking removes slots that are not booked yet. Appointments already in the
              diary stay booked — cancel those individually so the patient is told.
            </Banner>
          ) : (
            <Banner tone="info" icon="info">
              Extra hours apply to this date alone, on top of your weekly schedule —
              including on a day you have otherwise blocked.
            </Banner>
          )}

          {error && <Banner tone="warn" icon="alert">{error}</Banner>}
        </form>
      </Modal>

      <Banner tone="info" icon="info" title="How slots are generated">
        Bookable times come from the scheduling engine: recurring rules, plus extra dated
        hours, minus blocked dates and ranges, minus already-booked slots, minus anything in
        the past or inside the lead time. Times are entered in {rules[0]?.timezone ?? "Asia/Dhaka"}
        {" "}and stored in UTC, so the schedule stays correct across timezones.
      </Banner>
    </>
  );
}

function Earnings({ self, appointments }) {
  const completed = appointments.filter((a) => a.status === "completed");
  const total = completed.reduce((s, a) => s + (a.fee ?? 0), 0);
  const avg = completed.length ? Math.round(total / completed.length) : 0;
  const bars = [42, 57, 49, 69, 62, 88];
  const months = ["Mar", "Apr", "May", "Jun", "Jul", "Aug"];

  return (
    <>
      <PageHeading
        title="Earnings"
        subtitle="Completed consultations and monthly trends."
        actions={<button className="button ghost"><Icon name="download" size={14} />Export report</button>}
      />

      <div className="earnings-card card">
        <div>
          <small>Total from completed consultations</small>
          <h2>৳ {total.toLocaleString("en-BD")}</h2>
          <p>{completed.length} consultation{completed.length === 1 ? "" : "s"}</p>
        </div>
        <div className="mini-chart">
          <svg viewBox="0 0 230 70" fill="none" aria-hidden="true">
            <path d="M0 58 C18 53, 24 56, 38 45 S59 52, 74 39 S95 43, 110 29 S135 38, 148 21 S171 28, 184 18 S207 23, 230 5" stroke="#c7eee5" strokeWidth="2" />
            <path d="M0 70V58 C18 53,24 56,38 45 S59 52,74 39 S95 43,110 29 S135 38,148 21 S171 28,184 18 S207 23,230 5V70Z" fill="#d9f7f0" opacity=".3" />
          </svg>
        </div>
      </div>

      <div className="admin-grid">
        <div className="admin-stat card"><span>Completed visits</span><strong>{completed.length}</strong><small>All time</small></div>
        <div className="admin-stat card"><span>Average fee</span><strong>৳ {avg.toLocaleString("en-BD")}</strong><small>Per consultation</small></div>
        <div className="admin-stat card"><span>Patient rating</span><strong>{self ? self.rating.toFixed(1) : "—"} ★</strong><small>{self ? `${self.ratingCount} reviews` : ""}</small></div>
      </div>

      <div className="section-card card">
        <SectionHead title="Monthly performance" note="Illustrative" />
        <div className="bar-chart">
          {bars.map((h, i) => (
            <div className="bar-column" key={months[i]}>
              <div className={`bar ${i === bars.length - 1 ? "current" : ""}`} style={{ height: `${h}%` }} />
              <span>{months[i]}</span>
            </div>
          ))}
        </div>
      </div>

      <Banner tone="info" icon="info">
        Payments are mocked for this MVP — the proposal scopes real gateway integration out.
        These figures come from the fees on completed appointments.
      </Banner>
    </>
  );
}
