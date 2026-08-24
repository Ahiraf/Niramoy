"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons.js";
import { Avatar, PageHeading, SectionHead, Field, Select, Banner, VerifiedBadge } from "./ui.js";

/**
 * Settings for whoever is signed in.
 *
 * Everything on this page comes from the session — a doctor sees their own
 * registration and chamber, an admin sees a staff account. The only fields a
 * user can change here are the ones they own; email and role are account
 * operations, and a doctor's specialty and fee live on the published profile.
 */

const ROLE_LABEL = {
  patient: "Patient account",
  doctor: "Doctor account",
  admin: "Staff account",
};

/** A preference row. Toggles are local to this build — nothing is sent yet. */
function ToggleRow({ icon, title, hint, on, onToggle }) {
  return (
    <button className="appointment-row as-button" onClick={onToggle} aria-pressed={on}>
      <div className="triage-option-icon"><Icon name={icon} size={15} /></div>
      <div className="appt-main">
        <strong>{title}</strong>
        <span>{hint}</span>
      </div>
      <span className={`toggle ${on ? "on" : ""}`} aria-hidden="true"><i /></span>
    </button>
  );
}

function LinkRow({ icon, title, hint, action, onClick }) {
  return (
    <button className="appointment-row as-button" onClick={onClick}>
      <div className="triage-option-icon"><Icon name={icon} size={15} /></div>
      <div className="appt-main">
        <strong>{title}</strong>
        <span>{hint}</span>
      </div>
      {action ?? <Icon name="chevron" size={15} style={{ transform: "rotate(-90deg)" }} />}
    </button>
  );
}

export function Settings({ user, role, doctor, reference, api, onNavigate, onUserChange, notify }) {
  const [form, setForm] = useState({
    name: user?.name ?? "",
    phone: user?.phone ?? "",
    division: user?.division ?? "",
    district: user?.district ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [reminders, setReminders] = useState(true);
  const [emails, setEmails] = useState(true);

  // Keep the form in step with the session (e.g. after a doctor is verified).
  useEffect(() => {
    setForm({
      name: user?.name ?? "",
      phone: user?.phone ?? "",
      division: user?.division ?? "",
      district: user?.district ?? "",
    });
  }, [user]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const divisions = reference?.divisions ?? [];
  const districts = divisions.find((d) => d.name === form.division)?.districts ?? [];

  const dirty =
    form.name !== (user?.name ?? "") ||
    form.phone !== (user?.phone ?? "") ||
    form.division !== (user?.division ?? "") ||
    form.district !== (user?.district ?? "");

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const result = await api.updateProfile(form);
    setSaving(false);

    if (!result.ok) {
      setError(result.message ?? "Could not save your changes.");
      return;
    }
    onUserChange?.(result.user);
    notify?.("Profile updated");
  };

  const identityLine =
    role === "doctor"
      ? doctor?.specialty
        ? `${doctor.specialty}${doctor.facility ? ` · ${doctor.facility}` : ""}`
        : "Doctor · profile pending"
      : role === "admin"
        ? "Platform administrator"
        : `Patient ID · ${user?.patientId ?? "—"}`;

  return (
    <>
      <PageHeading
        title="Settings"
        subtitle={
          role === "admin"
            ? "Your staff account and platform preferences."
            : "Manage your profile, preferences and account security."
        }
      />

      <div className="two-col">
        <section className="section-card card">
          <SectionHead title="Personal information" note={ROLE_LABEL[role]} />

          <div className="settings-identity">
            <Avatar person={user} size="lg" />
            <div>
              <strong>{user?.name}</strong>
              <p>{identityLine}</p>
            </div>
          </div>

          <form onSubmit={save}>
            <Field label="Full name" error={error}>
              <input
                className="field" value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>

            <Field label="Email address" hint="Your sign-in address. Contact support to change it.">
              <input className="field" type="email" value={user?.email ?? ""} readOnly disabled />
            </Field>

            <Field label="Phone number">
              <input
                className="field" value={form.phone} inputMode="tel"
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+880 1XXX XXXXXX"
              />
            </Field>

            {role !== "admin" && (
              <div className="field-row">
                <Field label="Division">
                  <Select
                    value={form.division}
                    onChange={(v) => {
                      const first = divisions.find((d) => d.name === v)?.districts?.[0] ?? "";
                      setForm((f) => ({ ...f, division: v, district: first }));
                    }}
                    options={divisions.length ? divisions.map((d) => d.name) : [form.division || "Dhaka"]}
                  />
                </Field>
                <Field
                  label="District"
                  hint={role === "doctor"
                    ? "Where you practise."
                    : "Used to rank nearby doctors first."}
                >
                  <Select
                    value={form.district}
                    onChange={(v) => set("district", v)}
                    options={districts.length ? districts : [form.district || "Dhaka"]}
                  />
                </Field>
              </div>
            )}

            <button className="button primary" type="submit" disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </form>
        </section>

        <section className="section-card card">
          <SectionHead title="Preferences" />

          {/* ---------------------------------------------------------- */}
          {role === "patient" && (
            <>
              <ToggleRow
                icon="bell" title="Appointment reminders"
                hint="An in-app reminder one hour before your visit"
                on={reminders} onToggle={() => setReminders((v) => !v)}
              />
              <ToggleRow
                icon="send" title="Email notifications"
                hint="Booking confirmations and prescription updates"
                on={emails} onToggle={() => setEmails((v) => !v)}
              />
              <LinkRow
                icon="users" title="Family account access"
                hint="Manage appointments for family members"
                onClick={() => onNavigate("family")}
              />
            </>
          )}

          {role === "doctor" && (
            <>
              <ToggleRow
                icon="bell" title="New booking alerts"
                hint="Tell me as soon as a patient books a slot"
                on={reminders} onToggle={() => setReminders((v) => !v)}
              />
              <ToggleRow
                icon="send" title="Daily schedule email"
                hint="Your consultations for the day, each morning"
                on={emails} onToggle={() => setEmails((v) => !v)}
              />
              <LinkRow
                icon="clock" title="Availability"
                hint="Recurring hours, slot length and exceptions"
                onClick={() => onNavigate("availability")}
              />
            </>
          )}

          {role === "admin" && (
            <>
              <ToggleRow
                icon="bell" title="Verification queue alerts"
                hint="Tell me when a doctor submits an application"
                on={reminders} onToggle={() => setReminders((v) => !v)}
              />
              <ToggleRow
                icon="send" title="Weekly coverage digest"
                hint="Directory growth by division and specialty"
                on={emails} onToggle={() => setEmails((v) => !v)}
              />
              <LinkRow
                icon="shield" title="Doctor verification"
                hint="Applications waiting on a BM&DC check"
                onClick={() => onNavigate("verification")}
              />
            </>
          )}

          <div className="appointment-row">
            <div className="triage-option-icon"><Icon name="shield" size={15} /></div>
            <div className="appt-main">
              <strong>Privacy &amp; security</strong>
              <span>Password, active sessions and data export</span>
            </div>
            <button className="text-link">Open</button>
          </div>

          {/* ---------------------------------------------------------- */}
          {role === "doctor" && (
            <div className="settings-registration">
              <SectionHead title="Registration" />
              <div className="settings-reg-row">
                <span>BM&amp;DC number</span>
                <strong>{doctor?.bmdcNumber ?? "—"}</strong>
              </div>
              <div className="settings-reg-row">
                <span>Status</span>
                {user?.verificationStatus === "verified" || doctor?.verified
                  ? <VerifiedBadge doctor={doctor} />
                  : <span className="status pending">Pending</span>}
              </div>
              {doctor && (
                <div className="settings-reg-row">
                  <span>Consultation fee</span>
                  <strong>{doctor.feeLabel ?? `৳ ${doctor.fee}`}</strong>
                </div>
              )}
              <p className="muted-note">
                Your specialty, chamber and fee live on your public profile — edit them from
                Availability and your profile, so patients always see what you actually offer.
              </p>
            </div>
          )}

          {role === "admin" && (
            <Banner tone="info" icon="shield" title="Staff account">
              Admin accounts can only be created with the staff invite code, and they can read
              doctors&apos; verification documents. Sign out when you step away.
            </Banner>
          )}
        </section>
      </div>
    </>
  );
}
