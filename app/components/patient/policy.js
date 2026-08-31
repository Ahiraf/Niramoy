"use client";

/**
 * The cancellation and refund terms, stated once and used everywhere they are
 * relevant.
 *
 * Written to match what the code actually does, not what a booking flow
 * usually promises:
 *
 *   - The cancellation window is the same 60 minutes that canCancel() enforces
 *     in lib/scheduling/engine.ts, so the page cannot drift from the rule.
 *   - There is no automated refund path in this build. The payment provider
 *     interface has refundPayment(), and no service calls it. Saying "refunded
 *     within 7 days" would be describing code that does not exist.
 *   - Payments run through a sandbox, so nothing is charged at all yet. That
 *     is stated rather than glossed, for the same reason the checkout sheet
 *     states it.
 */

import { Icon } from "../icons.js";

/** Matches the default cancelWindowMinutes in the scheduling engine. */
export const CANCEL_WINDOW_MINUTES = 60;

const TERMS = [
  {
    icon: "check",
    title: "Free cancellation up to an hour before",
    body: "Cancel or reschedule at no cost until 60 minutes before the start time. The slot goes back to the doctor's availability immediately, and anyone on the waitlist is offered it.",
  },
  {
    icon: "clock",
    title: "Inside the last hour",
    body: "The slot can no longer be cancelled in the app, because the doctor has held that time for you. Contact the chamber directly if something urgent has come up.",
  },
  {
    icon: "alert",
    title: "If you don't attend",
    body: "An appointment nobody joins is marked as missed 30 minutes after it ends. It stays on your record; nothing is deducted.",
  },
  {
    icon: "info",
    title: "Refunds",
    body: "Payments are running through a sandbox in this build — no money moves and there is nothing to refund. Automated refunds are not implemented yet; a live deployment would settle them through the wallet that took the payment.",
  },
];

export function CancellationPolicy({ appointment = null, compact = false }) {
  return (
    <section className={`policy-block${compact ? " compact" : ""}`} aria-label="Cancellation and refund policy">
      <h3>
        <Icon name="shield" size={14} />
        Cancelling, missing and refunds
      </h3>

      <dl>
        {TERMS.map((term) => (
          <div key={term.title}>
            <dt>
              <Icon name={term.icon} size={12} />
              {term.title}
            </dt>
            <dd>{term.body}</dd>
          </div>
        ))}
      </dl>

      {appointment?.canCancel === false && (
        <p className="policy-now">
          This appointment is inside the last hour, so it can no longer be
          cancelled here.
        </p>
      )}
    </section>
  );
}
