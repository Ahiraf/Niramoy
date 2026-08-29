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

import { useState } from "react";
import { Icon } from "../icons.js";
import { Modal, Field, Banner } from "../ui.js";

/** 01712345678, and the same shape the server validates. */
const WALLET = /^01[3-9]\d{8}$/;

export function BkashCheckout({ open, payment, appointment, onClose, onPaid, api, notify }) {
  const [wallet, setWallet] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!payment) return null;

  const digits = wallet.replace(/[\s-]/g, "");

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

  return (
    <Modal open={open} title="Pay with bKash" onClose={onClose}>
      <form className="bkash-sheet" onSubmit={submit}>
        <div className="bkash-head">
          <span className="bkash-mark">bKash</span>
          <div className="bkash-amount">
            <span>Amount payable</span>
            <strong>৳ {fee}</strong>
          </div>
        </div>

        {appointment && (
          <p className="bkash-for">
            {appointment.doctor?.name ?? "Consultation"} · {appointment.date} {appointment.month},{" "}
            {appointment.time}
          </p>
        )}

        <Field
          label="Your bKash account number"
          hint="The 11-digit number the wallet is registered to."
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

        <Banner tone="info" icon="shield">
          Niramoy never asks for your bKash PIN. On a live payment you would
          approve it in bKash itself — if any site asks you to type your PIN
          into their page, it is not bKash.
        </Banner>

        <Banner tone="warn" icon="info">
          Sandbox payment. Nothing is charged and no money moves.
        </Banner>

        <div className="bkash-actions">
          <button type="button" className="button ghost" onClick={onClose} disabled={submitting}>
            Pay later
          </button>
          <button type="submit" className="button primary" disabled={submitting}>
            {submitting ? "Confirming…" : `Confirm ৳ ${fee}`}
            {!submitting && <Icon name="arrow" size={14} />}
          </button>
        </div>
      </form>
    </Modal>
  );
}
