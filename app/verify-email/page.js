"use client";

/**
 * /verify-email?token=… — the link in the confirmation email.
 *
 * This page existed only as a URL: notifications built
 * `${APP_URL}/verify-email?token=…` and nothing served that path, so every
 * confirmation email led to a 404. The address stayed unverified and there was
 * no way for the recipient to tell whether the fault was theirs.
 *
 * It runs on arrival rather than behind a button. The token is single-use and
 * already in the URL, so asking the reader to press "confirm" would only add a
 * step that can fail; the outcome is reported either way.
 */
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { LanguageProvider } from "../lib/i18n.js";
import { api } from "../lib/api.js";

function VerifyEmail() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState({ status: "working" });

  useEffect(() => {
    if (!token) {
      setState({
        status: "failed",
        message: "That link is missing its confirmation code. Open the link from your email directly.",
      });
      return;
    }

    let cancelled = false;
    (async () => {
      const result = await api.verifyEmail({ token });
      if (cancelled) return;
      setState(
        result.ok
          ? { status: "done", message: result.message ?? "Your email address is confirmed." }
          : {
              status: "failed",
              // The server's own wording: it distinguishes an expired link from
              // one that has already been used, and both matter to the reader.
              message: result.message ?? "That link is invalid or has expired.",
            },
      );
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <main className="auth-page" style={{ gridTemplateColumns: "1fr" }}>
      <div className="auth-main">
        <div className="auth-card">
          <h1>
            {state.status === "working" ? "Confirming your email…" :
             state.status === "done" ? "Email confirmed" : "We couldn't confirm that"}
          </h1>

          {state.status !== "working" && <p className="auth-sub">{state.message}</p>}

          {state.status === "failed" && (
            <p className="auth-sub">
              Confirmation links expire. Sign in and ask for a new one from Settings.
            </p>
          )}

          <Link className="button primary" href="/">
            {state.status === "done" ? "Continue to Niramoy" : "Back to Niramoy"}
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  // useSearchParams needs a Suspense boundary to prerender.
  return (
    <LanguageProvider>
      <Suspense fallback={<main className="auth-page" />}>
        <VerifyEmail />
      </Suspense>
    </LanguageProvider>
  );
}
