"use client";

/**
 * The bKash confirmation sheet.
 *
 * Stands in for the page bKash hosts on its own domain in a live tokenized
 * checkout. Two things about that are load-bearing rather than cosmetic:
 *
 *   1. There is NO PIN FIELD, and there never should be. On the real flow the
 *      payer is redirected to bKash and authenticates there; a merchant never
 *      sees the credential. A Niramoy-branded page asking for a bKash PIN is
 *      indistinguishable from a phishing screen, and putting one here — even
 *      mocked — would be rehearsing patients into the habit that makes MFS
 *      phishing work. The note in the sheet says so out loud.
 *
 *   2. It says plainly that nothing is charged. A sandbox that looks like a
 *      real payment is worse than no payment screen at all.
 */

import { useEffect, useState } from "react";
import { Icon } from "../icons.js";
import { Modal, Field, Banner } from "../ui.js";
import { useT } from "../../lib/i18n.js";

/** 01712345678, and the same shape the server validates. */
const WALLET = /^01[3-9]\d{8}$/;

/**
 * Seconds left on the payment session, or null when it does not expire.
 *
 * Ticks locally but is only ever a DISPLAY of the server's deadline: the
 * server refuses an expired execute regardless of what this shows, so a paused
 * tab or a fiddled clock cannot buy extra time.
 */
function useCountdown(expiresAt) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(null);
      return undefined;
    }
    const deadline = new Date(expiresAt).getTime();
    const tick = () => setRemaining(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  return remaining;
}

export function BkashCheckout({ open, payment, appointment, onClose, onPaid, api, notify }) {
  const [wallet, setWallet] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const remaining = useCountdown(payment?.expiresAt ?? null);
  const { t } = useT();

  if (!payment) return null;

  const expired = remaining === 0;
  const clock =
    remaining === null
      ? null
      : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;

  const digits = wallet.replace(/[\s-]/g, "");

  /*
   * A hosted gateway (SSLCommerz fronting bKash) sends the payer to its own
   * page, so there is nothing for us to confirm and no wallet number to take.
   * Rendering the two-step sheet here would be a form whose submit button
   * cannot do anything — the server refuses execute on a redirect provider.
   */
  const redirecting = payment.flow === "redirect" && Boolean(payment.redirectUrl);

  const submit = async (event) => {
    event.preventDefault();
    if (!WALLET.test(digits)) {
      setError("Enter the 11-digit bKash number, e.g. 01712345678.");
      return;
    }
    setError("");
    setSubmitting(true);
    const result = await api.executePayment(payment.id, { walletNumber: digits });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message ?? "That payment couldn't be confirmed.");
      return;
    }
    notify?.("Payment confirmed. Nothing was charged — this is a sandbox.");
    onPaid?.(result.payment);
  };

  const fee = new Intl.NumberFormat("en-BD").format(payment.amount);

  if (redirecting) {
    return (
      <Modal open={open} title={t("pay.redirectTitle")} onClose={onClose}>
        <div className="bkash-sheet">
          <div className="bkash-head">
            <span className="bkash-mark">bKash</span>
            <div className="bkash-amount">
              <span>{t("pay.amount")}</span>
              <strong>৳ {fee}</strong>
            </div>
          </div>

          {appointment && (
            <p className="bkash-for">
              {appointment.doctor?.name ?? "Consultation"} · {appointment.date} {appointment.month},{" "}
              {appointment.time}
            </p>
          )}

          <p className="bkash-for">{t("pay.redirectBody")}</p>

          <Banner tone="info" icon="check" title={t("booking.booked")}>
            {t("pay.slotSafe")}
          </Banner>

          {/* Still the most important line on the screen: we are about to send
              them somewhere else, which is exactly when a payer is most open
              to being sent somewhere else by someone who is not us. */}
          <Banner tone="info" icon="shield">
            {t("pay.noPin")}
          </Banner>

          {payment.sandbox && (
            <Banner tone="warn" icon="info">
              {t("pay.sandboxGateway")}
            </Banner>
          )}

          <div className="bkash-actions">
            <button type="button" className="button ghost" onClick={onClose}>
              {t("pay.later")}
            </button>
            {/*
              A plain link, not a fetch. The payer must SEE bkash's own URL and
              padlock in the address bar — that is the one habit that protects
              them, and loading a payment page in an iframe or a popup we styled
              would be teaching them to skip the check.
            */}
            <a className="button primary" href={payment.redirectUrl} rel="noopener">
              {t("pay.redirectCta")}
              <Icon name="arrow" size={14} />
            </a>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} title={t("pay.title")} onClose={onClose}>
      <form className="bkash-sheet" onSubmit={submit}>
        <div className="bkash-head">
          <span className="bkash-mark">bKash</span>
          <div className="bkash-amount">
            <span>{t("pay.amount")}</span>
            <strong>৳ {fee}</strong>
          </div>
          {clock && (
            <div className={`bkash-clock ${remaining <= 60 ? "urgent" : ""}`}>
              <Icon name="clock" size={12} />
              <strong>{clock}</strong>
              <span>session</span>
            </div>
          )}
        </div>

        {appointment && (
          <p className="bkash-for">
            {appointment.doctor?.name ?? "Consultation"} · {appointment.date} {appointment.month},{" "}
            {appointment.time}
          </p>
        )}

        <Field
          label={t("pay.walletLabel")}
          hint={t("pay.walletHint")}
          error={error}
        >
          <input
            className="field"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={14}
            placeholder="01712345678"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
          />
        </Field>

        {expired ? (
          <Banner tone="warn" icon="alert" title={t("pay.expired")}>
            Close this and start the payment again from your appointments.
          </Banner>
        ) : (
          <Banner tone="info" icon="check" title={t("booking.booked")}>
            {t("pay.slotSafe")}
          </Banner>
        )}

        {/* The anti-phishing line, in the patient's own language. This is
            the string most worth translating in the whole payment flow. */}
        <Banner tone="info" icon="shield">
          {t("pay.noPin")}
        </Banner>

        <Banner tone="warn" icon="info">
          {t("pay.sandbox")}
        </Banner>

        <div className="bkash-actions">
          <button type="button" className="button ghost" onClick={onClose} disabled={submitting}>
            {t("pay.later")}
          </button>
          <button type="submit" className="button primary" disabled={submitting || expired}>
            {submitting ? "Confirming…" : expired ? "Session expired" : `Confirm ৳ ${fee}`}
            {!submitting && !expired && <Icon name="arrow" size={14} />}
          </button>
        </div>
      </form>
    </Modal>
  );
}
