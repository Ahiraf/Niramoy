"use client";

import { useState } from "react";
import { Icon } from "./icons.js";
import { PageHeading, Field, Select, Banner, SectionHead, Modal } from "./ui.js";

const BMDC_ERRORS = {
  bmdc_missing: "Please enter your BM&DC registration number.",
  bmdc_malformed: "That doesn't look like a BM&DC number. Use the format A-45312 (or just the digits).",
  bmdc_type_mismatch: "The prefix doesn't match the registration type you selected.",
  bmdc_type_required: "Select your registration type.",
  bmdc_unknown_prefix: "Unrecognised registration prefix.",
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Shown to a doctor whose application is with an admin. Deliberately not a
 * half-working workspace: until the BM&DC number is confirmed there is no
 * bookable profile, so there is nothing to schedule against.
 */
export function DoctorPending({ user, onRefresh, onSignOut }) {
  return (
    <div className="pending-screen">
      <div className="pending-card card">
        <div className="pending-icon"><Icon name="clock" size={22} /></div>
        <h1>Your application is being verified</h1>
        <p>
          Thanks, {user.name}. An admin is confirming your BM&amp;DC registration against the
          official register at verify.bmdc.org.bd. This is a human check, not an automatic one —
          it usually takes under two working days.
        </p>

        <ol className="step-list pending-steps">
          <li className="done"><strong>Account created</strong><span>{user.email}</span></li>
          <li className="done"><strong>Application submitted</strong><span>Format of your registration number checked.</span></li>
          <li className="current"><strong>Admin verification</strong><span>In progress — you&apos;ll be notified by email.</span></li>
          <li><strong>Profile goes live</strong><span>Patients can find and book you.</span></li>
        </ol>

        <div className="pending-actions">
          <button className="button primary" onClick={onRefresh}>
            <Icon name="refresh" size={14} /> Check status
          </button>
          <button className="button ghost" onClick={onSignOut}>
            <Icon name="logout" size={14} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The real onboarding path. A doctor supplies their BM&DC registration number;
 * it is shape-checked here and on the server, then queued for a human admin to
 * confirm against verify.bmdc.org.bd. Nothing auto-approves.
 */
export function JoinAsDoctor({ reference, api, onNavigate, notify, defaults = {}, onSubmitted, showBack = true }) {
  const [form, setForm] = useState({
    name: "", email: "", phone: "",
    bmdcNumber: "", registrationType: "mbbs",
    specialty: reference?.specialties?.[0]?.name ?? "General Physician",
    degrees: "", facility: "",
    division: "Dhaka", district: "Dhaka",
    experienceYears: "", fee: "", bio: "",
    languages: ["Bangla", "English"],
    days: [0, 1, 2, 3, 4],
    startHour: "17", endHour: "21", slotMinutes: "20",
    // A doctor who just signed up arrives with name, email and BM&DC number
    // already filled in — no reason to ask twice.
    ...Object.fromEntries(Object.entries(defaults).filter(([, v]) => v !== "" && v != null)),
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const districts =
    reference?.divisions?.find((d) => d.name === form.division)?.districts ?? [];

  const toggleDay = (i) =>
    set("days", form.days.includes(i) ? form.days.filter((d) => d !== i) : [...form.days, i].sort());

  const toggleLanguage = (lang) =>
    set("languages", form.languages.includes(lang)
      ? form.languages.filter((l) => l !== lang)
      : [...form.languages, lang]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    // Availability rules are stored in UTC; the doctor enters Bangladesh time.
    const availability = form.days.map((weekday) => ({
      weekday,
      start: `${String(Number(form.startHour) - 6).padStart(2, "0")}:00`,
      end: `${String(Number(form.endHour) - 6).padStart(2, "0")}:00`,
      slotMinutes: Number(form.slotMinutes),
      bufferMinutes: 0,
      localStart: `${form.startHour.padStart(2, "0")}:00`,
      localEnd: `${form.endHour.padStart(2, "0")}:00`,
    }));

    const specialtyId = reference?.specialties?.find((s) => s.name === form.specialty)?.id;
    const result = await api.applyAsDoctor({ ...form, specialtyId, availability });

    setSubmitting(false);
    if (!result.ok) {
      setError(BMDC_ERRORS[result.reason] ?? "Something went wrong. Please check your details.");
      return;
    }
    setDone(result);
    notify?.("Application submitted for BM&DC verification");
  };

  return (
    <>
      <PageHeading
        title="Join Niramoy as a doctor"
        subtitle="Every doctor on Niramoy is verified against the BM&DC register before their profile goes live."
        back={showBack ? { label: "Back to dashboard", onClick: () => onNavigate("dashboard") } : undefined}
      />

      <Banner tone="info" icon="shield" title="Why we ask for your BM&DC number">
        Bangladesh has no public registry we can import doctors from — the BM&amp;DC verification
        service checks one registration at a time. So we verify each doctor individually: you submit
        your number, an admin confirms it at verify.bmdc.org.bd, and only then does your profile
        become bookable.
      </Banner>

      <form className="join-layout" onSubmit={submit}>
        <section className="card section-card">
          <SectionHead title="Your registration" note="Required" />

          <div className="field-row">
            <Field label="Registration type">
              <Select
                value={form.registrationType}
                onChange={(v) => set("registrationType", v)}
                options={[
                  { value: "mbbs", label: "MBBS (Medical) — prefix A" },
                  { value: "bds", label: "BDS (Dental) — prefix D" },
                  { value: "mat", label: "Medical Assistant — prefix M" },
                ]}
              />
            </Field>
            <Field
              label="BM&DC registration number"
              hint="e.g. A-45312. You can also enter just the digits."
              error={error}
            >
              <input
                className="field"
                value={form.bmdcNumber}
                onChange={(e) => set("bmdcNumber", e.target.value)}
                placeholder="A-45312"
                required
              />
            </Field>
          </div>

          <a className="text-link" href="https://verify.bmdc.org.bd/" target="_blank" rel="noreferrer noopener">
            <Icon name="shield" size={13} /> Check your number on the BM&amp;DC verification service
          </a>

          <SectionHead title="About you" />
          <div className="field-row">
            <Field label="Full name">
              <input className="field" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Dr. …" required />
            </Field>
            <Field label="Email">
              <input className="field" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Phone">
              <input className="field" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+880 …" />
            </Field>
            <Field label="Years of experience">
              <input className="field" type="number" min="0" max="60" value={form.experienceYears} onChange={(e) => set("experienceYears", e.target.value)} required />
            </Field>
          </div>

          <Field label="Qualifications" hint="As they appear on your certificates.">
            <input className="field" value={form.degrees} onChange={(e) => set("degrees", e.target.value)} placeholder="MBBS, FCPS (Medicine)" required />
          </Field>

          <Field label="Specialty">
            <Select
              value={form.specialty}
              onChange={(v) => set("specialty", v)}
              options={reference?.specialties?.map((s) => s.name) ?? []}
            />
          </Field>

          <Field label="Languages you consult in">
            <div className="chip-row">
              {(reference?.languages ?? ["Bangla", "English"]).map((lang) => (
                <button
                  type="button" key={lang}
                  className={`chip ${form.languages.includes(lang) ? "on" : ""}`}
                  onClick={() => toggleLanguage(lang)}
                >
                  {lang}
                </button>
              ))}
            </div>
          </Field>

          <SectionHead title="Where you practise" />
          <div className="field-row">
            <Field label="Division">
              <Select
                value={form.division}
                onChange={(v) => {
                  const first = reference?.divisions?.find((d) => d.name === v)?.districts?.[0] ?? "";
                  setForm((f) => ({ ...f, division: v, district: first }));
                }}
                options={reference?.divisions?.map((d) => d.name) ?? []}
              />
            </Field>
            <Field label="District">
              <Select value={form.district} onChange={(v) => set("district", v)} options={districts} />
            </Field>
          </div>
          <Field label="Hospital or chamber">
            <input className="field" value={form.facility} onChange={(e) => set("facility", e.target.value)} placeholder="e.g. Dhaka Medical College Hospital" required />
          </Field>

          <SectionHead title="Consultation" />
          <div className="field-row">
            <Field label="Fee (৳)">
              <input className="field" type="number" min="0" step="50" value={form.fee} onChange={(e) => set("fee", e.target.value)} required />
            </Field>
            <Field label="Slot length">
              <Select
                value={form.slotMinutes}
                onChange={(v) => set("slotMinutes", v)}
                options={[
                  { value: "15", label: "15 minutes" },
                  { value: "20", label: "20 minutes" },
                  { value: "30", label: "30 minutes" },
                ]}
              />
            </Field>
          </div>

          <Field label="Weekly availability" hint="Bangladesh Standard Time. You can refine this later.">
            <div className="chip-row">
              {WEEKDAYS.map((d, i) => (
                <button
                  type="button" key={d}
                  className={`chip ${form.days.includes(i) ? "on" : ""}`}
                  onClick={() => toggleDay(i)}
                >
                  {d.slice(0, 3)}
                </button>
              ))}
            </div>
          </Field>
          <div className="field-row">
            <Field label="From">
              <Select
                value={form.startHour} onChange={(v) => set("startHour", v)}
                options={Array.from({ length: 16 }, (_, i) => ({ value: String(i + 6), label: `${String(i + 6).padStart(2, "0")}:00` }))}
              />
            </Field>
            <Field label="Until">
              <Select
                value={form.endHour} onChange={(v) => set("endHour", v)}
                options={Array.from({ length: 16 }, (_, i) => ({ value: String(i + 7), label: `${String(i + 7).padStart(2, "0")}:00` }))}
              />
            </Field>
          </div>

          <Field label="Short bio" hint="Shown on your public profile.">
            <textarea className="field textarea" rows={3} value={form.bio} onChange={(e) => set("bio", e.target.value)} />
          </Field>
        </section>

        <aside className="card join-side">
          <h3>What happens next</h3>
          <ol className="step-list">
            <li><strong>You submit</strong><span>Your registration number is format-checked immediately.</span></li>
            <li><strong>An admin verifies</strong><span>They confirm your number against the BM&amp;DC register by hand.</span></li>
            <li><strong>Your profile goes live</strong><span>Patients can find and book you. You keep control of your hours.</span></li>
          </ol>

          <div className="secure-note">
            <Icon name="shield" size={15} />
            <span>
              Your registration number is only used to confirm you are licensed to practise. It is
              shown on your public profile, as it already is on the public BM&amp;DC register.
            </span>
          </div>

          <button className="button primary" style={{ width: "100%" }} type="submit" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit for verification"}
            {!submitting && <Icon name="arrow" size={14} />}
          </button>
        </aside>
      </form>

      <Modal
        open={Boolean(done)}
        title="Application submitted"
        onClose={() => { setDone(null); onSubmitted ? onSubmitted() : onNavigate("dashboard"); }}
        footer={
          <button
            className="button primary"
            onClick={() => { setDone(null); onSubmitted ? onSubmitted() : onNavigate("dashboard"); }}
          >
            Done
          </button>
        }
      >
        <p>
          Thanks — your application for <strong>{done?.application?.bmdcNumber}</strong> is in the
          verification queue.
        </p>
        <p className="muted-note">{done?.lookup?.reason}</p>
        <Banner tone="info" icon="info">
          Verification is done by a person, so it isn&apos;t instant. Signing in with an{" "}
          <strong>admin</strong> account shows the same application in the verification queue — that
          is the flow a real Niramoy admin would follow.
        </Banner>
      </Modal>
    </>
  );
}
