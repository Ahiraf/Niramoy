"use client";

import { Icon } from "../icons.js";
import { Avatar, PageHeading, SectionHead, Stat, Empty, Loading, Rating, VerifiedBadge } from "../ui.js";

export function Dashboard({ loading, appointments, doctors, records, stats, onNavigate, onOpenDoctor, onJoinCall }) {
  const upcoming = appointments.filter((a) => ["confirmed", "pending"].includes(a.status));
  const next = upcoming[0];
  const completed = appointments.filter((a) => a.status === "completed");

  return (
    <>
      <PageHeading
        title="Good to see you, Nabila"
        subtitle="Here's what's happening with your care today."
        actions={
          <>
            <button className="button ghost" onClick={() => onNavigate("appointments")}>
              <Icon name="calendar" size={14} />View calendar
            </button>
            <button className="button primary" onClick={() => onNavigate("doctors")}>
              <Icon name="plus" size={14} />Book appointment
            </button>
          </>
        }
      />

      <div className="hero-grid">
        <section className="welcome-card">
          <small>Your health, in one place</small>
          <h2>Care that comes to you.</h2>
          <p>
            {stats
              ? `${stats.doctors} verified doctors across ${stats.divisionsCovered} divisions and ${stats.districtsCovered} districts of Bangladesh.`
              : "Connect with trusted doctors, understand your symptoms and keep your health journey organised."}
          </p>
          <button className="button" onClick={() => onNavigate("assistant")}>
            Talk to Niramoy AI <Icon name="arrow" size={14} />
          </button>
        </section>

        <section className="next-card card">
          {loading ? (
            <Loading rows={1} />
          ) : next ? (
            <>
              <div className="card-top">
                <span className="eyebrow">Next appointment</span>
                <span className={`status ${next.status}`}>{next.status}</span>
              </div>
              <h3>Ready when you are</h3>
              <div className="next-appointment">
                <div className="date-chip">
                  <strong>{next.date}</strong>
                  <span>{next.month}</span>
                </div>
                <Avatar person={next.doctor} />
                <div className="doctor-detail">
                  <strong>{next.doctor?.name}</strong>
                  <span>{next.doctor?.specialty}</span>
                </div>
              </div>
              <div className="next-footer">
                <span><Icon name="clock" size={12} /> {next.time} · {next.day}</span>
                <button className="button primary small" onClick={() => onJoinCall(next)}>
                  <Icon name="video" size={13} />Join call
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="card-top"><span className="eyebrow">Next appointment</span></div>
              <Empty
                icon="calendar"
                title="Nothing booked yet"
                hint="Find a doctor and pick a time that suits you."
                action={
                  <button className="button primary small" onClick={() => onNavigate("doctors")}>
                    Find a doctor
                  </button>
                }
              />
            </>
          )}
        </section>
      </div>

      <div className="stat-grid">
        <Stat icon="calendar" label="Upcoming visits" value={String(upcoming.length).padStart(2, "0")} trend={upcoming.length ? "Next one is soon" : "None scheduled"} />
        <Stat icon="file" tone="orange" label="Records & prescriptions" value={String(records.length).padStart(2, "0")} trend="In your timeline" />
        <Stat icon="check" tone="purple" label="Completed visits" value={String(completed.length).padStart(2, "0")} trend="All time" />
        <Stat icon="users" tone="blue" label="Doctors available" value={stats ? String(stats.doctors) : "—"} trend={stats ? `${stats.specialties} specialties` : ""} />
      </div>

      <div className="two-col">
        <section className="section-card card">
          <SectionHead
            title="Upcoming consultations"
            action={<button className="text-link" onClick={() => onNavigate("appointments")}>See all</button>}
          />
          {loading ? <Loading /> : upcoming.length ? (
            upcoming.slice(0, 4).map((a) => (
              <button className="appointment-row as-button" key={a.id} onClick={() => onNavigate("appointments")}>
                <div className="date-chip"><strong>{a.date}</strong><span>{a.month}</span></div>
                <Avatar person={a.doctor} size="sm" />
                <div className="appt-main">
                  <strong>{a.doctor?.name}</strong>
                  <span>{a.doctor?.specialty} · {a.type}</span>
                </div>
                <div className="appt-time"><strong>{a.time}</strong><span>{a.day}</span></div>
              </button>
            ))
          ) : (
            <Empty icon="calendar" title="No upcoming consultations" hint="Your next booking will appear here." />
          )}
        </section>

        <section className="section-card card">
          <SectionHead
            title="Top rated near you"
            action={<button className="text-link" onClick={() => onNavigate("doctors")}>Explore</button>}
          />
          {loading ? <Loading /> : (
            <div className="doctor-mini-list">
              {doctors.slice(0, 4).map((d) => (
                <button className="doctor-mini" key={d.id} onClick={() => onOpenDoctor(d)}>
                  <Avatar person={d} size="sm" />
                  <div className="doctor-mini-main">
                    <strong>{d.name}</strong>
                    <span>{d.specialty} · {d.district}</span>
                  </div>
                  <Rating value={d.rating} />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
