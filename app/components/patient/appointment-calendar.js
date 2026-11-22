"use client";

import { useState } from "react";
import { PageHeading, Loading, Empty } from "../ui.js";
import { Icon } from "../icons.js";

const dayKey = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const labels = { booked: "Booked", missed: "Missed", rescheduled: "Rescheduled", consulted: "Consulted", cancelled: "Cancelled" };
function kind(a) {
  if (a.status === "no_show") return "missed";
  if (a.status === "completed") return "consulted";
  if (a.status === "cancelled") return "cancelled";
  return a.rescheduleCount > 0 ? "rescheduled" : "booked";
}

export function AppointmentCalendar({ appointments, loading, onNavigate }) {
  const today = dayKey(Date.now());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [year, number] = month.split("-").map(Number);
  const offset = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const groups = {};
  appointments.forEach((a) => {
    if (!a.startUtc) return;
    const key = dayKey(a.startUtc);
    (groups[key] ??= []).push(a);
  });
  const move = (delta) => {
    const next = new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7);
    setMonth(next); setSelected(`${next}-01`);
  };
  return <>
    <PageHeading title="Appointment calendar" subtitle="Your care schedule, in Bangladesh time."
      actions={<button className="button ghost" onClick={() => onNavigate("dashboard")}><Icon name="back" size={16} />Back to overview</button>} />
    {loading ? <Loading rows={3} /> : <div className="appointment-calendar card">
      <div className="calendar-toolbar">
        <h2>{new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</h2>
        <div><button className="button ghost small" aria-label="Previous month" onClick={() => move(-1)}><Icon name="back" size={18} /></button>
          <button className="button secondary small" onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>Today</button>
          <button className="button ghost small" aria-label="Next month" onClick={() => move(1)}><Icon name="arrow" size={18} /></button></div>
      </div>
      <div className="calendar-legend">{Object.entries(labels).map(([key, label]) => <span className={`calendar-tag ${key}`} key={key}>{label}</span>)}</div>
      <div className="calendar-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <span className="calendar-weekday" key={d}>{d}</span>)}
        {Array.from({ length: offset }, (_, i) => <span key={`empty-${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const key = `${month}-${String(i + 1).padStart(2, "0")}`;
          const visits = groups[key] ?? [];
          return <button key={key} className={`calendar-day ${selected === key ? "selected" : ""} ${today === key ? "today" : ""}`} aria-pressed={selected === key}
            aria-label={`${key}: ${visits.length ? visits.map((a) => `${labels[kind(a)]} with ${a.doctor?.name}`).join(", ") : "No appointments"}`} onClick={() => setSelected(key)}>
            <strong>{i + 1}</strong><span className="calendar-markers">{[...new Set(visits.map(kind))].map((k) => <span key={k} className={`calendar-dot ${k}`} />)}</span>
            {visits.length > 0 && <small>{visits.length} <span>visit{visits.length > 1 ? "s" : ""}</span></small>}
          </button>;
        })}
      </div>
      <section className="calendar-agenda" aria-live="polite">
        <h3>{new Date(`${selected}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</h3>
        {(groups[selected] ?? []).sort((a, b) => a.startUtc.localeCompare(b.startUtc)).map((a) => <div className="calendar-visit" key={a.id}>
          <time>{new Date(a.startUtc).toLocaleTimeString("en-BD", { timeZone: "Asia/Dhaka", hour: "numeric", minute: "2-digit" })}</time>
          <div><strong>{a.doctor?.name ?? "Doctor appointment"}</strong><p>{a.doctor?.specialty} · {a.type}</p>
            {a.rescheduleCount > 0 && kind(a) !== "rescheduled" && <small>Previously rescheduled</small>}</div>
          <span className={`calendar-tag ${kind(a)}`}>{labels[kind(a)]}</span>
        </div>)}
        {!groups[selected]?.length && <Empty icon="calendar" title="No appointments on this day" hint="Choose a marked day to see your visits." />}
        <button className="button secondary small" onClick={() => onNavigate("appointments")}>Manage appointments</button>
      </section>
    </div>}
  </>;
}
