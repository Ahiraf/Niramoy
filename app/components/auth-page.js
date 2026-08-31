"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "./icons.js";
import { Field, Select } from "./ui.js";

/**
 * Sign in / sign up for all three roles.
 *
 * The role is part of the credential check, not just a UI filter: signing in
 * with a patient account on the doctor tab fails with a message that says so,
 * rather than silently opening the wrong workspace.
 */

const ROLE_TABS = [
  { id: "patient", label: "Patient", icon: "heart" },
  { id: "doctor", label: "Doctor", icon: "badge" },
  { id: "admin", label: "Admin", icon: "shield" },
];

const ROLE_PITCH = {
  patient: {
    title: "Your care, in one place",
    points: [
      "Search doctors across all 64 districts",
      "AI triage points you to the right specialty",
      "Prescriptions and visit history kept together",
      "Book for family members from your own account",
    ],
  },
  doctor: {
    title: "Practise beyond your chamber",
    points: [
      "A bookable profile once your BM&DC number is verified",
      "Set recurring hours — slots generate themselves",
      "No double bookings, ever",
      "AI-drafted visit summaries you review and sign off",
    ],
  },
  admin: {
    title: "Keep the directory honest",
    points: [
      "Work the BM&DC verification queue",
      "Confirm each registration against the official register",
      "Publish or reject applications with a note",
      "Track coverage across divisions and specialties",
    ],
  },
};

const MESSAGES = {
  bad_credentials: "That email and password don't match an account.",
  email_taken: "An account already uses that email. Try signing in instead.",
  email_invalid: "That doesn't look like a valid email address.",
  name_required: "Please tell us your name.",
  password_too_short: "Use at least 8 characters.",
  password_too_simple: "Mix letters and numbers.",
  invite_invalid: "That staff invite code isn't valid.",
  bmdc_missing: "Please enter your BM&DC registration number.",
  bmdc_malformed: "Use the format A-45312 (or just the digits).",
  bmdc_type_mismatch: "The prefix doesn't match the registration type you picked.",
  bmdc_unknown_prefix: "Unrecognised registration prefix.",
  http_500: "Something went wrong on our side. Please try again.",
};

const DEMO = [
  { role: "patient", email: "nabila@example.com", name: "Nabila Begum" },
  { role: "doctor", email: "ayesha@example.com", name: "Dr. Ayesha Khan" },
  { role: "admin", email: "sakib@example.com", name: "Sakib Rahman" },
];
const DEMO_PASSWORD = "niramoy123";

const EMPTY = {
  name: "", email: "", password: "", phone: "",
  division: "Dhaka", district: "Dhaka",
  bmdcNumber: "", registrationType: "mbbs", specialty: "",
  inviteCode: "",
};

export function AuthPage({ mode: initialMode, role: initialRole, reference, api, onBack, onAuthenticated }) {
  const [mode, setMode] = useState(initialMode ?? "signin");
  const [role, setRole] = useState(initialRole ?? "patient");
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => { setMode(initialMode ?? "signin"); }, [initialMode]);
  useEffect(() => { setRole(initialRole ?? "patient"); }, [initialRole]);
  useEffect(() => { setError(null); setFieldErrors({}); }, [mode, role]);

  const specialties = reference?.specialties ?? [];
  const divisions = reference?.divisions ?? [];
  const districts = useMemo(
    () => divisions.find((d) => d.name === form.division)?.districts ?? [],
    [divisions, form.division]
  );

  useEffect(() => {
    if (!form.specialty && specialties.length) set("specialty", specialties[0].name);
  }, [specialties, form.specialty]);

  const signUp = mode === "signup";
  const pitch = ROLE_PITCH[role];

  const explain = (result) =>
    MESSAGES[result.reason] ?? result.message ?? "Something went wrong. Please try again.";

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);

    const result = signUp
      ? await api.register({
          name: form.name,
          email: form.email,
          password: form.password,
          phone: form.phone,
          role,
          ...(role === "patient" ? { division: form.division, district: form.district } : {}),
          ...(role === "doctor"
            ? {
                bmdcNumber: form.bmdcNumber,
                registrationType: form.registrationType,
                specialty: form.specialty,
              }
            : {}),
          ...(role === "admin" ? { inviteCode: form.inviteCode } : {}),
        })
      : await api.login({ email: form.email, password: form.password, role });

    setBusy(false);

    if (!result.ok) {
      // Signing in on the wrong tab is a common slip — say exactly that.
      if (result.reason === "wrong_role" && result.actualRole) {
        setError(`That's a ${result.actualRole} account. Switch to the ${result.actualRole} tab to sign in.`);
        return;
      }
      const message = explain(result);
      if (result.reason?.startsWith("password_")) setFieldErrors({ password: message });
      else if (result.reason?.startsWith("bmdc_")) setFieldErrors({ bmdcNumber: message });
      else if (result.reason === "invite_invalid") setFieldErrors({ inviteCode: message });
      else if (result.reason === "email_taken" || result.reason === "email_invalid") setFieldErrors({ email: message });
      else setError(message);
      return;
    }

    onAuthenticated(result.user, result.draft ?? null);
  };

  const applyDemoAccount = (account) => {
    setRole(account.role);
    setMode("signin");
    setForm({ ...EMPTY, email: account.email, password: DEMO_PASSWORD });
    setError(null);
  };

  return (
    <div className="auth-page">
      {/* ------------------------------------------------------------------ */}
      <aside className="auth-aside">
        <button className="auth-back" onClick={onBack}>
          <Icon name="back" size={14} /> Back to home
        </button>

        <div className="brand light">
          <div className="brand-mark"><Icon name="heart" size={20} strokeWidth={2.2} /></div>
          <div className="brand-name">nira<span>moy</span></div>
        </div>

        <div className="auth-aside-body">
          <h2>{pitch.title}</h2>
          <ul>
            {pitch.points.map((p) => (
              <li key={p}><Icon name="check" size={13} /> {p}</li>
            ))}
          </ul>
        </div>

        <div className="auth-demo">
          <strong>Reviewing the project?</strong>
          <p>Use a ready-made account — password <code>{DEMO_PASSWORD}</code>.</p>
          <div className="auth-demo-row">
            {DEMO.map((account) => (
              <button key={account.role} onClick={() => applyDemoAccount(account)}>
                {account.role}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* ------------------------------------------------------------------ */}
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-role-tabs" role="tablist" aria-label="Account type">
            {ROLE_TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={role === tab.id}
                className={`auth-role-tab ${role === tab.id ? "active" : ""}`}
                onClick={() => setRole(tab.id)}
              >
                <Icon name={tab.icon} size={14} /> {tab.label}
              </button>
            ))}
          </div>

          <h1>{signUp ? `Create your ${role} account` : `Sign in as ${role === "admin" ? "an admin" : `a ${role}`}`}</h1>
          <p className="auth-sub">
            {signUp
              ? role === "doctor"
                ? "We'll check your BM&DC number's format now; an admin confirms it against the register before your profile goes live."
                : role === "admin"
                  ? "Admin accounts are staff accounts — you'll need the invite code from your team."
                  : "One account for appointments, records and your family's care."
              : "Welcome back. Pick the tab that matches your account."}
          </p>

          {error && (
            <div className="auth-error" role="alert">
              <Icon name="alert" size={14} /> {error}
            </div>
          )}

          <form onSubmit={submit} noValidate>
            {signUp && (
              <Field label={role === "doctor" ? "Full name (as registered with BM&DC)" : "Full name"}>
                <input
                  className="field" value={form.name} autoComplete="name" required
                  onChange={(e) => set("name", e.target.value)}
                  placeholder={role === "doctor" ? "Ayesha Khan" : "Nabila Begum"}
                />
              </Field>
            )}

            <Field label="Email" error={fieldErrors.email}>
              <input
                className="field" type="email" value={form.email} autoComplete="email" required
                onChange={(e) => set("email", e.target.value)}
                placeholder="you@example.com"
              />
            </Field>

            {signUp && (
              <Field label="Mobile number" hint="Used for appointment reminders.">
                <input
                  className="field" value={form.phone} autoComplete="tel" inputMode="tel"
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="+880 1XXX XXXXXX"
                />
              </Field>
            )}

            <Field
              label="Password"
              error={fieldErrors.password}
              hint={signUp ? "At least 8 characters, with a number." : undefined}
            >
              <div className="auth-password">
                <input
                  className="field" type={showPassword ? "text" : "password"} value={form.password}
                  autoComplete={signUp ? "new-password" : "current-password"} required
                  onChange={(e) => set("password", e.target.value)}
                  placeholder="••••••••"
                />
                <button
                  type="button" className="auth-reveal"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </Field>

            {signUp && role === "patient" && (
              <div className="field-row">
                <Field label="Division">
                  <Select
                    value={form.division}
                    onChange={(v) => {
                      const first = divisions.find((d) => d.name === v)?.districts?.[0] ?? "";
                      setForm((f) => ({ ...f, division: v, district: first }));
                    }}
                    options={divisions.length ? divisions.map((d) => d.name) : ["Dhaka"]}
                  />
                </Field>
                <Field label="District" hint="We use this to show nearby doctors first.">
                  <Select
                    value={form.district}
                    onChange={(v) => set("district", v)}
                    options={districts.length ? districts.map((d) => d.name ?? d) : ["Dhaka"]}
                  />
                </Field>
              </div>
            )}

            {signUp && role === "doctor" && (
              <>
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
                  <Field label="BM&DC registration number" error={fieldErrors.bmdcNumber} hint="e.g. A-45312">
                    <input
                      className="field" value={form.bmdcNumber} required
                      onChange={(e) => set("bmdcNumber", e.target.value)}
                      placeholder="A-45312"
                    />
                  </Field>
                </div>
                <Field label="Primary specialty">
                  <Select
                    value={form.specialty}
                    onChange={(v) => set("specialty", v)}
                    options={specialties.length ? specialties.map((s) => s.name) : ["General Physician"]}
                  />
                </Field>
              </>
            )}

            {signUp && role === "admin" && (
              <Field
                label="Staff invite code"
                error={fieldErrors.inviteCode}
                hint="Issued by the Niramoy team. Admin accounts can't be created without one."
              >
                <input
                  className="field" value={form.inviteCode} required
                  onChange={(e) => set("inviteCode", e.target.value)}
                  placeholder="NIRAMOY-ADMIN"
                />
              </Field>
            )}

            {signUp && role === "doctor" && (
              <p className="auth-note">
                <Icon name="shield" size={13} />
                After sign-up you&rsquo;ll complete a short profile — hours, fee, chamber — and an admin
                verifies your registration at verify.bmdc.org.bd. Your profile becomes bookable only
                once that check passes.
              </p>
            )}

            <button className="button primary auth-submit" type="submit" disabled={busy}>
              {busy ? "Please wait…" : signUp ? "Create account" : "Sign in"}
              {!busy && <Icon name="arrow" size={13} />}
            </button>
          </form>

          <p className="auth-swap">
            {signUp ? "Already have an account?" : "New to Niramoy?"}{" "}
            <button className="text-link" onClick={() => setMode(signUp ? "signin" : "signup")}>
              {signUp ? "Sign in" : `Create ${role === "admin" ? "an admin" : `a ${role}`} account`}
            </button>
          </p>

          <p className="auth-legal">
            By continuing you agree that Niramoy is not a substitute for emergency care. For
            emergencies, call 999.
          </p>
        </div>
      </main>
    </div>
  );
}
