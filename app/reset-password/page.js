"use client";

/**
 * /reset-password?token=… — the link in the password-reset email.
 *
 * Like /verify-email, this path was only ever a string in an email body: the
 * notification built it and nothing served it, so every reset link 404'd and
 * the account stayed locked out with no way back in.
 *
 * The token is spent by the SERVER when the new password is submitted, and
 * completing a reset signs the account straight in on a fresh session — every
 * older session is revoked, which is the point of resetting a password you
 * think somebody else may know.
 */
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { LanguageProvider } from "../lib/i18n.js";
import { api } from "../lib/api.js";

function ResetPassword() {
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await api.completePasswordReset({ token, newPassword: password });
    setBusy(false);

    if (!result.ok) {
      // The server checks strength and returns each failed rule separately;
      // showing them all beats "invalid password" and a guess.
      const problems = result.error?.details?.newPassword;
      setError(problems?.length ? problems.join(" ") : result.message ?? "That didn't work.");
      return;
    }
    setDone(true);
  };

  if (!token) {
    return (
      <Shell title="That link is incomplete">
        <p className="auth-sub">
          It is missing its reset code. Open the link from your email directly, or ask for a new one.
        </p>
        <Link className="button primary" href="/">Back to Niramoy</Link>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell title="Password changed">
        <p className="auth-sub">
          You&rsquo;re signed in on this device. Every other session has been signed out.
        </p>
        <Link className="button primary" href="/">Continue to Niramoy</Link>
      </Shell>
    );
  }

  return (
    <Shell title="Choose a new password">
      <p className="auth-sub">
        This link works once. Signing in elsewhere will need the new password.
      </p>

      {error && <div className="auth-error" role="alert">{error}</div>}

      <form onSubmit={submit}>
        <label className="field-label" htmlFor="new-password">New password</label>
        <div className="password-field">
          <input
            id="new-password"
            className="field"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="button" className="text-link" onClick={() => setShow((v) => !v)}>
            {show ? "Hide" : "Show"}
          </button>
        </div>
        <p className="field-hint">At least 8 characters, including a letter and a number.</p>

        <button className="button primary" type="submit" disabled={busy || !password}>
          {busy ? "Saving…" : "Set new password"}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ title, children }) {
  return (
    <main className="auth-page" style={{ gridTemplateColumns: "1fr" }}>
      <div className="auth-main">
        <div className="auth-card">
          <h1>{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <LanguageProvider>
      <Suspense fallback={<main className="auth-page" />}>
        <ResetPassword />
      </Suspense>
    </LanguageProvider>
  );
}
