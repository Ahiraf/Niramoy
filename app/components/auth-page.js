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

/** Fields this form actually renders, and so can show a problem against. */
const FORM_FIELDS = new Set([
  "name", "email", "password", "phone",
  "division", "district",
  "bmdcNumber", "registrationType", "specialty",
  "inviteCode",
]);

/**
 * The first step of signing up: prove the number before filling in anything
 * else.
 *
 * Patients and doctors pass through here; staff accounts do not, because an
 * invite code already establishes who they are. Nothing is created until the
 * code comes back — there is no half-made account to clean up if somebody
 * mistypes a digit and walks away.
 *
 * The five-minute clock is shown counting down rather than left implicit. A
 * code that has quietly expired looks exactly like a code that is wrong, and
 * the difference — resend, versus check what you typed — is the one thing the
 * person needs to know.
 */
function SignupOtpStep({ api, role, onVerified, onBack }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(null);
  const [deadline, setDeadline] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Computed from wall-clock rather than counted down, so a tab that slept
  // through the window comes back showing the truth instead of 4:58.
  useEffect(() => {
    if (!deadline) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const secondsLeft = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
  const expired = Boolean(sent) && secondsLeft === 0;
  const clock = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  const send = async () => {
    setBusy(true);
    setError(null);
    const result = await api.sendSignupOtp({ phone });
    setBusy(false);

    if (!result.ok) {
      setError(result.error?.details?.phone?.[0] ?? result.message);
      return;
    }
    setSent(result.phoneVerification);
    setDeadline(Date.now() + result.phoneVerification.expiresInSeconds * 1000);
    setNow(Date.now());
    setCode("");
  };

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await api.confirmSignupOtp({ phone, code });
    setBusy(false);

    if (!result.ok) {
      setError(result.error?.details?.code?.[0] ?? result.message);
      return;
    }
    // The ticket is what registration spends; the raw number goes with it,
    // because a ticket is only good for the number it was issued against.
    onVerified({ phone, masked: result.phoneVerification.phone, ticket: result.phoneVerification.ticket });
  };

  return (
    <div className="auth-card">
      <div className="auth-step-line" aria-hidden="true">
        <span className="on">1</span>
        <i />
        <span>2</span>
      </div>

      <h1>{role === "doctor" ? "Confirm your mobile number" : "Start with your mobile number"}</h1>
      <p className="auth-sub">
        {sent
          ? `We sent a six-digit code to ${sent.phone}.`
          : "We'll text you a six-digit code. Appointment reminders go to this number too."}
        <br />
        <span lang="bn">
          {sent ? "কোডটি নিচে লিখুন।" : "আপনার মোবাইলে একটি কোড পাঠানো হবে।"}
        </span>
      </p>

      {error && (
        <div className="auth-error" role="alert">
          <Icon name="alert" size={14} /> {error}
        </div>
      )}

      {sent && !sent.delivered && (
        <p className="auth-note">
          <Icon name="alert" size={13} />
          No SMS gateway is connected to this deployment, so the code was written to the server
          log instead of sent.
        </p>
      )}

      {!sent ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          noValidate
        >
          <Field label="Mobile number" hint="Bangladeshi mobile numbers only.">
            <input
              className="field" value={phone} autoComplete="tel" inputMode="tel" required
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01712 345678"
            />
          </Field>
          <button className="button primary auth-submit" type="submit" disabled={busy || !phone.trim()}>
            {busy ? "Sending…" : "Send OTP"}
            {!busy && <Icon name="arrow" size={13} />}
          </button>
        </form>
      ) : (
        <form onSubmit={confirm} noValidate>
          <Field label="Six-digit code">
            <input
              className="field auth-otp" value={code} required autoFocus
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]*"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              disabled={expired}
            />
          </Field>

          <p className={`auth-countdown ${expired ? "out" : ""}`} role="timer" aria-live="off">
            <Icon name="clock" size={13} />
            {expired ? "This code has expired. Send a new one." : `Expires in ${clock}`}
          </p>

          <button
            className="button primary auth-submit"
            type="submit"
            disabled={busy || expired || code.length !== 6}
          >
            {busy ? "Checking…" : "Verify and continue"}
            {!busy && <Icon name="arrow" size={13} />}
          </button>
        </form>
      )}

      <p className="auth-swap">
        {sent && (
          <>
            <button className="text-link" onClick={send} disabled={busy}>
              {expired ? "Send a new code" : "Send it again"}
            </button>
            {" · "}
            <button
              className="text-link"
              onClick={() => { setSent(null); setDeadline(null); setError(null); }}
              disabled={busy}
            >
              Change number
            </button>
          </>
        )}
      </p>

      <p className="auth-legal">
        <button className="text-link" onClick={onBack}>Back to sign in</button>
      </p>
    </div>
  );
}

/**
 * The step between "account created" and "you're in": read the six digits we
 * just sent to the number on the account, and type them back.
 *
 * Skippable, deliberately. The account already exists and the session is
 * already issued, so blocking here would strand somebody whose handset is out
 * of signal on a screen they cannot leave. What skipping costs is stated on the
 * screen rather than discovered later: no SMS reminders until it is done.
 *
 * `delivered: false` means no gateway is configured and the code was printed to
 * the server log instead of sent. That is said plainly — a screen that asks for
 * a code nobody could receive, without explaining why, is the worst version of
 * this flow.
 */
function PhoneStep({ api, pending, onVerified, onSkip }) {
  const [state, setState] = useState(pending.state);
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState(!pending.state);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);

  const resend = async (nextPhone) => {
    setBusy(true);
    setError(null);
    setNote(null);
    const result = await api.sendPhoneCode(nextPhone ? { phone: nextPhone } : {});
    setBusy(false);

    if (!result.ok) {
      setError(result.error?.details?.phone?.[0] ?? result.message);
      return;
    }
    setState(result.phoneVerification);
    setEditing(false);
    setCode("");
    setNote(
      result.phoneVerification.delivered
        ? "A new code is on its way."
        : "No SMS gateway is configured here, so the code was printed to the server log."
    );
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    const result = await api.confirmPhoneCode({ code });
    setBusy(false);

    if (!result.ok) {
      setError(result.error?.details?.code?.[0] ?? result.message);
      return;
    }
    onVerified();
  };

  return (
    <div className="auth-card">
      <h1>Confirm your mobile number</h1>
      <p className="auth-sub">
        {state
          ? `We sent a six-digit code to ${state.phone}. It expires in ${state.expiresInMinutes} minutes.`
          : "We couldn't send a code just now. Check the number and try again."}
        <br />
        <span lang="bn">আপনার মোবাইলে পাঠানো ছয় সংখ্যার কোডটি লিখুন।</span>
      </p>

      {error && (
        <div className="auth-error" role="alert">
          <Icon name="alert" size={14} /> {error}
        </div>
      )}
      {note && <p className="auth-note" role="status">{note}</p>}

      {state && !state.delivered && (
        <p className="auth-note">
          <Icon name="alert" size={13} />
          No SMS gateway is connected to this deployment, so the code was written to the server
          log instead of sent.
        </p>
      )}

      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            resend(phone);
          }}
          noValidate
        >
          <Field label="Mobile number" hint="Bangladeshi mobile numbers only — that's where the code goes.">
            <input
              className="field" value={phone} autoComplete="tel" inputMode="tel" required
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01712 345678"
            />
          </Field>
          <button className="button primary auth-submit" type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send the code"}
          </button>
        </form>
      ) : (
        <form onSubmit={submit} noValidate>
          <Field label="Six-digit code">
            <input
              className="field" value={code} required
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]*"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              aria-describedby="phone-step-help"
            />
          </Field>
          <button className="button primary auth-submit" type="submit" disabled={busy || code.length !== 6}>
            {busy ? "Checking…" : "Confirm number"}
            {!busy && <Icon name="arrow" size={13} />}
          </button>
        </form>
      )}

      <p className="auth-swap" id="phone-step-help">
        <button className="text-link" onClick={() => resend()} disabled={busy}>
          Send it again
        </button>
        {" · "}
        <button className="text-link" onClick={() => { setEditing(true); setNote(null); }} disabled={busy}>
          Use a different number
        </button>
      </p>

      <p className="auth-legal">
        You can do this later from Settings. Until then we can email you, but appointment
        reminders won&rsquo;t reach you by SMS.
      </p>
      <button className="text-link" onClick={onSkip}>Skip for now</button>
    </div>
  );
}

export function AuthPage({ mode: initialMode, role: initialRole, reference, api, onBack, onAuthenticated }) {
  const [mode, setMode] = useState(initialMode ?? "signin");
  const [role, setRole] = useState(initialRole ?? "patient");
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  /** Set once an account exists but its number is still unproved. */
  const [pending, setPending] = useState(null);
  /** Set once the number is proved and before the account exists. */
  const [verified, setVerified] = useState(null);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => { setMode(initialMode ?? "signin"); }, [initialMode]);
  useEffect(() => { setRole(initialRole ?? "patient"); }, [initialRole]);
  // A proved number belongs to the tab it was proved on. Switching role or
  // going to sign-in drops it: the ticket is for one number and one account,
  // and carrying it around would be a claim nobody made.
  useEffect(() => {
    setError(null);
    setFieldErrors({});
    setVerified(null);
  }, [mode, role]);

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
          // The proved number and the ticket that proves it, together: the
          // server will only accept the ticket for the number it was issued to.
          phone: verified?.phone ?? form.phone,
          ...(verified ? { verificationTicket: verified.ticket } : {}),
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

      /**
       * Put each problem on the field it belongs to.
       *
       * The server answers a failed sign-up with `details` keyed by field —
       * a short password, a name left blank. Branching on `reason` alone
       * misses all of them, because they share the one reason
       * `validation_failed`, and the user is left reading "some of the
       * details aren't valid" with no way to tell which. Anything we have no
       * field for still goes to the banner, so nothing is silently dropped.
       */
      const details = result.error?.details ?? {};
      const perField = {};
      let unplaced = false;
      for (const [field, problems] of Object.entries(details)) {
        const problem = Array.isArray(problems) ? problems[0] : problems;
        if (!problem) continue;
        if (FORM_FIELDS.has(field)) perField[field] = problem;
        else unplaced = true;
      }

      if (Object.keys(perField).length) {
        setFieldErrors(perField);
        if (unplaced) setError(message);
      } else if (result.reason?.startsWith("password_")) setFieldErrors({ password: message });
      else if (result.reason?.startsWith("bmdc_")) setFieldErrors({ bmdcNumber: message });
      else if (result.reason === "invite_invalid") setFieldErrors({ inviteCode: message });
      else if (result.reason === "email_taken" || result.reason === "email_invalid") setFieldErrors({ email: message });
      else setError(message);
      return;
    }

    // A new account with an unproved number stops here first. Signing in does
    // not: the number was proved once, or it was skipped once, and re-asking on
    // every sign-in would be a nag rather than a check.
    if (signUp && result.user?.phone && !result.user.phoneVerified) {
      setPending({
        user: result.user,
        draft: result.draft ?? null,
        state: result.phoneVerification ?? null,
      });
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
        {signUp && role !== "admin" && !verified && !pending ? (
          <SignupOtpStep
            api={api}
            role={role}
            onVerified={setVerified}
            onBack={() => setMode("signin")}
          />
        ) : pending ? (
          <PhoneStep
            api={api}
            pending={pending}
            onVerified={() =>
              onAuthenticated({ ...pending.user, phoneVerified: true }, pending.draft)
            }
            onSkip={() => onAuthenticated(pending.user, pending.draft)}
          />
        ) : (
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
              <Field
                label={role === "doctor" ? "Full name (as registered with BM&DC)" : "Full name"}
                error={fieldErrors.name}
              >
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

            {/* Already proved, one step ago. Shown rather than asked for again,
                and not editable here: the ticket the server will check was
                issued against this exact number. */}
            {signUp && verified && (
              <Field label="Mobile number" hint="Confirmed. Appointment reminders go here.">
                <div className="auth-verified-phone">
                  <Icon name="check" size={14} />
                  <strong>{verified.masked}</strong>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => setVerified(null)}
                  >
                    Use a different number
                  </button>
                </div>
              </Field>
            )}

            {signUp && !verified && (
              <Field
                label="Mobile number"
                error={fieldErrors.phone}
                hint="Optional for staff accounts."
              >
                <input
                  className="field" value={form.phone} autoComplete="tel" inputMode="tel"
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="01712 345678"
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
        )}
      </main>
    </div>
  );
}
