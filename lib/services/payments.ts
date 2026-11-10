/**
 * Niramoy — payment orchestration
 * -----------------------------------------------------------------------------
 * The invariant: a payment reaches `succeeded` only because a verified webhook
 * said so, or because the mock provider is in use and everything is labelled as
 * such. There is no endpoint a client can call to declare their own payment
 * successful.
 */

import { and, desc, eq, sql } from "drizzle-orm";

import { audit } from "../audit";
import { getDb } from "../db/client";
import * as t from "../db/schema";
import { isUniqueViolation } from "../db/errors";
import { AppError } from "../errors";
import { logger } from "../observability/logger";
import {
  getPaymentProvider,
  isWalletNumber,
  type PaymentMethod,
  type PaymentStatus,
  type WebhookVerification,
} from "../payments/provider";
import type { Principal } from "../security/authz";

/**
 * How long a started wallet payment stays confirmable.
 *
 * A real bKash tokenized checkout hands out a payment that must be executed
 * within minutes, and there is no reason for ours to be immortal: a `pending`
 * row that can be executed a week later is a stale authorisation sitting on an
 * account. Derived from createdAt rather than stored, so there is no second
 * source of truth to drift.
 *
 * NOTE this is the PAYMENT that expires, not the slot. The appointment is
 * already booked and stays booked — see the checkout sheet's copy.
 */
export const PAYMENT_SESSION_MINUTES = 10;

export const sessionExpiresAt = (createdAt: Date): Date =>
  new Date(createdAt.getTime() + PAYMENT_SESSION_MINUTES * 60_000);

export interface PaymentView {
  id: string;
  status: PaymentStatus;
  method: PaymentMethod;
  amount: number;
  currency: string;
  provider: string;
  isMock: boolean;
  /**
   * A real gateway moving unreal money. Distinct from `isMock`: the SSLCommerz
   * sandbox runs the actual API, the actual hosted page and the actual IPN, so
   * the code path is genuine even though nothing is charged. The UI needs to be
   * able to say exactly that rather than picking between "mocked" and "live",
   * neither of which would be true.
   */
  sandbox: boolean;
  /** `redirect` means there is no confirm step on our side to render. */
  flow: "two-step" | "redirect";
  redirectUrl: string | null;
  /** When this payment can no longer be confirmed. Null once it is settled. */
  expiresAt: string | null;
}

/** Reject anything that is not one of the two instruments we actually offer. */
function readMethod(value: unknown): PaymentMethod {
  const method = String(value ?? "bkash");
  if (method !== "bkash" && method !== "cash") {
    throw new AppError("VALIDATION_FAILED", {
      details: { method: ["Choose bKash or paying at the chamber."] },
    });
  }
  return method;
}

/**
 * Start a payment for an appointment.
 *
 * The amount comes from the APPOINTMENT ROW, never from the request. A
 * client-supplied amount is how someone pays ৳1 for a ৳1,200 consultation.
 */
export async function startPayment(
  principal: Principal & { patientId: string },
  input: { appointmentId?: unknown; idempotencyKey?: unknown; method?: unknown },
  context: { requestId?: string; appUrl: string },
): Promise<PaymentView> {
  const db = getDb();
  const provider = getPaymentProvider();
  const method = readMethod(input.method);

  const appointmentId = String(input.appointmentId ?? "");
  const rows = await db
    .select({
      id: t.appointments.id,
      reference: t.appointments.reference,
      feeAmount: t.appointments.feeAmount,
      currency: t.appointments.currency,
      status: t.appointments.status,
    })
    .from(t.appointments)
    .where(
      and(eq(t.appointments.id, appointmentId), eq(t.appointments.patientId, principal.patientId)),
    )
    .limit(1);

  const appointment = rows[0];
  if (!appointment) throw new AppError("NOT_FOUND");
  if (["cancelled", "no_show"].includes(appointment.status)) {
    throw new AppError("NOT_ELIGIBLE", { message: "That consultation is no longer scheduled." });
  }

  /*
   * The idempotency key, NAMESPACED to this appointment.
   *
   * The column is globally unique, so a client-supplied key is otherwise a
   * string one patient can use to collide with another's — reading their
   * payment back on a match, or squatting the key so their checkout cannot
   * open. Prefixing it with the appointment id makes both impossible while
   * keeping what the key is actually for: two identical clicks from the same
   * patient on the same consultation de-duplicate.
   */
  const clientKey = String(input.idempotencyKey ?? "").trim().slice(0, 80);
  const baseKey = clientKey ? `appt:${appointment.id}:${clientKey}` : `appt:${appointment.id}`;

  /*
   * The most recent attempt on this consultation, whatever it was keyed as.
   *
   * Looked up by APPOINTMENT rather than by key, because a retry is stored
   * under a new key (`…#2`) and a lookup by the key the client happens to have
   * sent would keep finding the spent first attempt and open a fresh gateway
   * session on every click.
   */
  const prior = (
    await db
      .select()
      .from(t.payments)
      .where(
        and(
          eq(t.payments.appointmentId, appointment.id),
          eq(t.payments.patientId, principal.patientId),
        ),
      )
      .orderBy(desc(t.payments.createdAt))
      .limit(1)
  )[0];

  /*
   * A replay of a LIVE payment returns that payment — including, for a hosted
   * gateway, a link to its page that still works.
   *
   * This is what made the pay button dead after the first click: the replay
   * path returned `redirectUrl: null`, so the checkout sheet saw a redirect
   * provider with nowhere to send the payer and fell back to rendering the
   * two-step wallet form — whose Confirm posts to an endpoint a redirect
   * provider refuses by design.
   */
  if (prior && prior.method === method) {
    const resumed = await resumeExisting(prior, appointment, context);
    if (resumed) return resumed;
  }

  /*
   * Nothing live to resume, so this is a genuinely new attempt and needs its
   * own key, and therefore its own gateway transaction id.
   */
  const attemptKey = prior ? await nextAttemptKey(appointment.id, baseKey) : baseKey;

  const amount = Number(appointment.feeAmount);

  // Cash is settled in person, so no gateway is involved and there is nothing
  // to charge. The row exists to record the patient's choice and to keep the
  // consultation's payment state answerable in one place; it stays `pending`
  // until whoever takes the money says otherwise.
  const intent = method === "cash"
    ? { providerPaymentId: null, status: "pending" as PaymentStatus, redirectUrl: null }
    : await provider.createPayment({
        amount,
        currency: appointment.currency,
        reference: appointment.reference,
        description: `Niramoy consultation ${appointment.reference}`,
        method,
        returnUrl: `${context.appUrl}/appointments`,
        idempotencyKey: attemptKey,
      });

  let paymentId: string;
  /** The row's own timestamp: the session deadline is derived from it. */
  let createdAt: Date;
  try {
    const inserted = await db
      .insert(t.payments)
      .values({
        appointmentId: appointment.id,
        patientId: principal.patientId,
        payerUserId: principal.userId,
        provider: method === "cash" ? "cash" : provider.name,
        method,
        isMock: provider.isMock ? "true" : "false",
        providerPaymentId: intent.providerPaymentId,
        amount: String(amount),
        currency: appointment.currency,
        // A real provider's intent starts pending regardless of what it claims;
        // only a verified webhook advances it.
        status: provider.isMock ? intent.status : "pending",
        idempotencyKey: attemptKey,
      })
      .returning({ id: t.payments.id, createdAt: t.payments.createdAt });
    paymentId = inserted[0]!.id;
    createdAt = inserted[0]!.createdAt;
  } catch (err) {
    if (isUniqueViolation(err)) {
      /*
       * Lost a race with an identical request; return the winner. Scoped to
       * this patient and appointment like every other read of this table — an
       * unscoped lookup by key here would hand back whatever row happened to
       * hold it, which is the leak the namespacing above exists to prevent.
       */
      const again = await db
        .select()
        .from(t.payments)
        .where(
          and(
            eq(t.payments.idempotencyKey, attemptKey),
            eq(t.payments.patientId, principal.patientId),
            eq(t.payments.appointmentId, appointment.id),
          ),
        )
        .limit(1);
      if (again[0]) {
        paymentId = again[0].id;
        createdAt = again[0].createdAt;
      } else throw err;
    } else {
      throw err;
    }
  }

  await audit({
    action: "payment.create",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId: context.requestId,
    resourceType: "payment",
    resourceId: paymentId,
    metadata: { provider: provider.name, method, isMock: provider.isMock, amount },
  });

  const status = provider.isMock ? intent.status : "pending";

  return {
    id: paymentId,
    status,
    method,
    amount,
    currency: appointment.currency,
    provider: method === "cash" ? "cash" : provider.name,
    isMock: provider.isMock,
    sandbox: method !== "cash" && provider.sandbox,
    flow: method === "cash" ? "two-step" : provider.flow,
    redirectUrl: intent.redirectUrl,
    // Cash is settled in person and never expires; a wallet payment is only
    // confirmable while its session lasts.
    expiresAt:
      status === "pending" && method === "bkash"
        ? sessionExpiresAt(createdAt).toISOString()
        : null,
  };
}

/** The appointment fields a payment is opened against. */
interface PayableAppointment {
  id: string;
  reference: string;
  currency: string;
}

/**
 * The next key in an appointment's attempt series.
 *
 * Counting rows rather than parsing suffixes: the count is what the unique
 * index ultimately arbitrates anyway, and two racing retries computing the same
 * key is handled by the unique-violation branch above rather than by being
 * clever here.
 */
async function nextAttemptKey(appointmentId: string, baseKey: string): Promise<string> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(t.payments)
    .where(eq(t.payments.appointmentId, appointmentId));
  return `${baseKey}#${(rows[0]?.n ?? 1) + 1}`;
}

/**
 * What to do with a payment row that already exists for this appointment.
 *
 * Returns a view to hand straight back, or null meaning "this attempt is spent,
 * open a fresh one". The distinction is the whole of retry: a patient must be
 * able to pay for an appointment they failed to pay for the first time, without
 * that ever becoming a second charge for one they DID pay for.
 */
async function resumeExisting(
  payment: PaymentRow,
  appointment: PayableAppointment,
  context: { appUrl: string },
): Promise<PaymentView | null> {
  const db = getDb();
  const provider = getPaymentProvider();

  // Settled, in either direction. There is nothing to restart.
  if (payment.status === "succeeded" || payment.status === "refunded") return toView(payment);
  // Cash never reaches a gateway; the row only records the patient's choice.
  if (payment.method === "cash") return toView(payment);

  /*
   * A provider swap since this row was written. Its transaction id means
   * nothing to the gateway now configured, so it can be neither resumed nor
   * reconciled against it.
   */
  const sameProvider = payment.provider === provider.name;

  const live =
    payment.status === "pending" &&
    Date.now() <= sessionExpiresAt(payment.createdAt).getTime();

  if (live && sameProvider && provider.flow === "redirect") {
    /*
     * Re-open the SAME transaction rather than a second one. `transactionId` is
     * derived from the idempotency key, so this reaches the session the payer
     * already has — which is the difference between resuming a payment and
     * creating one they could pay twice.
     */
    const intent = await provider.createPayment({
      amount: Number(payment.amount),
      currency: payment.currency,
      reference: appointment.reference,
      description: `Niramoy consultation ${appointment.reference}`,
      method: "bkash",
      returnUrl: `${context.appUrl}/appointments`,
      idempotencyKey: payment.idempotencyKey,
    });
    return toView(payment, intent.redirectUrl);
  }

  if (live) return toView(payment);

  /* ---- Spent: failed, cancelled, or a lapsed session -------------------- */

  /*
   * Ask the GATEWAY about the old transaction before opening a new one.
   *
   * A pending row can mean the payer never paid — or that they paid and the IPN
   * never arrived. Opening a second session on the strength of our own row is
   * exactly how a patient pays twice, and our row is the one piece of evidence
   * that cannot tell those two cases apart.
   */
  if (sameProvider && provider.flow === "redirect" && payment.providerPaymentId) {
    const atGateway = await provider
      .getPaymentStatus(payment.providerPaymentId)
      .catch(() => null);

    if (atGateway === "succeeded") {
      logger.warn("a spent payment session turns out to have settled at the gateway", {
        paymentId: payment.id,
      });
      await db
        .update(t.payments)
        .set({ providerStatusRaw: "reconciled:succeeded", updatedAt: new Date() })
        .where(eq(t.payments.id, payment.id));

      /*
       * Deliberately NOT marked succeeded here. This call reports a status, not
       * an amount, and the amount check is the control that catches a tampered
       * payment. The IPN, or the payer's own return, settles it properly.
       */
      throw new AppError("ALREADY_EXISTS", {
        message:
          "bKash has already taken a payment for this consultation. Give it a moment and refresh — we're confirming it now.",
      });
    }
  }

  // Close the lapsed row so it can never be confirmed later, then let the
  // caller open a fresh attempt.
  if (payment.status === "pending") {
    await db
      .update(t.payments)
      .set({ status: "cancelled", failureReason: "session_expired", updatedAt: new Date() })
      .where(and(eq(t.payments.id, payment.id), eq(t.payments.status, "pending")));
  }

  return null;
}

/**
 * Confirm a wallet payment the payer has authorised.
 *
 * The status still comes from the PROVIDER, never from the request: the client
 * says "I authorised this", and the provider says whether that is true. A
 * caller cannot name the status it wants, which is what keeps the invariant at
 * the top of this file intact through the second step of the flow.
 */
export async function executePayment(
  principal: Principal & { patientId: string },
  paymentId: string,
  input: { walletNumber?: unknown },
  context: { requestId?: string },
): Promise<PaymentView> {
  const db = getDb();
  const provider = getPaymentProvider();

  const rows = await db
    .select()
    .from(t.payments)
    .where(and(eq(t.payments.id, paymentId), eq(t.payments.patientId, principal.patientId)))
    .limit(1);

  const payment = rows[0];
  if (!payment) throw new AppError("NOT_FOUND");

  if (payment.method !== "bkash") {
    throw new AppError("NOT_ELIGIBLE", {
      message: "That consultation isn't being paid by wallet.",
    });
  }

  /*
   * A redirect gateway has no execute step: the payer authorised on the
   * gateway's own page and settlement arrives by IPN. Refusing here rather
   * than in the provider keeps the reason accurate — there is nothing wrong
   * with the request, it is the wrong half of a flow that does not have one.
   */
  if (provider.flow === "redirect") {
    throw new AppError("NOT_ELIGIBLE", {
      message: "This payment is confirmed by bKash. Reopen it from your appointments to check.",
      meta: { provider: provider.name, reason: "redirect_flow_has_no_execute" },
    });
  }
  // Already settled. Return it rather than running the flow twice — a double
  // tap on "Confirm" must not become a second execute call to the wallet.
  if (payment.status === "succeeded") return toView(payment);
  if (payment.status !== "pending") {
    throw new AppError("NOT_ELIGIBLE", { message: "That payment can no longer be confirmed." });
  }

  /*
   * The session, not the slot. Refusing here is what makes the countdown in
   * the checkout sheet mean something: without this the timer would run out
   * and the payment would still go through, which is a worse lie than having
   * no timer at all.
   */
  if (Date.now() > sessionExpiresAt(payment.createdAt).getTime()) {
    await db
      .update(t.payments)
      .set({ status: "cancelled", failureReason: "session_expired", updatedAt: new Date() })
      .where(and(eq(t.payments.id, payment.id), eq(t.payments.status, "pending")));

    throw new AppError("NOT_ELIGIBLE", {
      message:
        "This bKash session has expired. Your appointment is still booked — start the payment again from your appointments.",
    });
  }

  const walletNumber = String(input.walletNumber ?? "").replace(/[\s-]/g, "");
  if (!isWalletNumber(walletNumber)) {
    throw new AppError("VALIDATION_FAILED", {
      details: { walletNumber: ["Enter the 11-digit bKash number, e.g. 01712345678."] },
    });
  }

  const result = await provider.executePayment({
    providerPaymentId: payment.providerPaymentId ?? "",
    walletNumber,
  });

  const updated = await db
    .update(t.payments)
    .set({
      status: result.status,
      providerStatusRaw: result.status,
      failureReason: result.reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(t.payments.id, payment.id))
    .returning();

  await audit({
    action: "payment.execute",
    actorUserId: principal.userId,
    actorRole: principal.role,
    requestId: context.requestId,
    resourceType: "payment",
    resourceId: payment.id,
    outcome: result.status === "succeeded" ? "success" : "failure",
    metadata: { provider: provider.name, status: result.status, reason: result.reason },
  });

  return toView(updated[0]!);
}

type PaymentRow = typeof t.payments.$inferSelect;

/**
 * A stored row as the client sees it.
 *
 * `redirectUrl` is passed in rather than read from the row: a hosted gateway
 * page is a short-lived session, not a property of the payment, and storing one
 * would mean handing back a link that had quietly stopped working.
 */
function toView(payment: PaymentRow, redirectUrl: string | null = null): PaymentView {
  const provider = getPaymentProvider();
  // Cash never reaches a gateway, so it inherits neither the flow nor the
  // sandbox labelling of whichever provider happens to be configured.
  const viaGateway = payment.method !== "cash";
  return {
    id: payment.id,
    status: payment.status as PaymentStatus,
    method: payment.method as PaymentMethod,
    amount: Number(payment.amount),
    currency: payment.currency,
    provider: payment.provider,
    isMock: payment.isMock === "true",
    sandbox: viaGateway && provider.sandbox,
    flow: viaGateway ? provider.flow : "two-step",
    redirectUrl,
    expiresAt:
      payment.status === "pending" && payment.method === "bkash"
        ? sessionExpiresAt(payment.createdAt).toISOString()
        : null,
  };
}

/**
 * Handle a provider webhook.
 *
 * Order matters: verify the signature FIRST, before the body is parsed for
 * anything meaningful or used to look a payment up. An unverified body is
 * attacker-controlled, and treating it as a lookup key is how a forged webhook
 * marks someone else's consultation paid.
 */
export async function handleWebhook(
  rawBody: string,
  headers: Headers,
  context: { requestId?: string },
): Promise<{ handled: boolean; reason?: string }> {
  const db = getDb();
  const provider = getPaymentProvider();

  const verification = await provider.verifyWebhook({ rawBody, headers });

  if (!verification.valid) {
    logger.warn("rejected an unverified payment webhook", {
      provider: provider.name,
      reason: verification.reason,
    });
    await audit({
      action: "payment.webhook",
      requestId: context.requestId,
      outcome: "denied",
      metadata: { provider: provider.name, reason: verification.reason },
    });
    // 403, not 400: this is an authentication failure, not a malformed request.
    throw new AppError("FORBIDDEN", { message: "Webhook signature verification failed." });
  }

  return settleVerified(verification, context);
}

/**
 * Apply an ALREADY-VERIFIED gateway statement to the payment row.
 *
 * Split out because settlement arrives by two routes — the IPN, and the payer's
 * own browser coming back with a validation id — and both must land on exactly
 * the same replay protection, amount check and audit trail. Two code paths that
 * both mark payments succeeded is one code path too many.
 *
 * The caller is responsible for having verified. Everything downstream of here
 * assumes `verification.valid` was true and was established server-to-server.
 */
async function settleVerified(
  verification: WebhookVerification,
  context: { requestId?: string },
): Promise<{ handled: boolean; reason?: string }> {
  const db = getDb();
  const provider = getPaymentProvider();

  if (!verification.eventId || !verification.providerPaymentId || !verification.status) {
    return { handled: false, reason: "incomplete_event" };
  }

  // Replay protection. A repeated event id conflicts and is ignored.
  const recorded = await db
    .insert(t.paymentWebhookEvents)
    .values({
      provider: provider.name,
      providerEventId: verification.eventId,
      signatureVerified: "true",
    })
    .onConflictDoNothing({
      target: [t.paymentWebhookEvents.provider, t.paymentWebhookEvents.providerEventId],
    })
    .returning({ id: t.paymentWebhookEvents.id });

  if (!recorded[0]) {
    logger.info("ignored a replayed payment webhook", { eventId: verification.eventId });
    return { handled: false, reason: "duplicate_event" };
  }

  const targets = await db
    .select()
    .from(t.payments)
    .where(
      and(
        eq(t.payments.provider, provider.name),
        eq(t.payments.providerPaymentId, verification.providerPaymentId),
      ),
    )
    .limit(1);

  const target = targets[0];
  if (!target) return { handled: false, reason: "unknown_payment" };

  /*
   * AMOUNT VERIFICATION. The control that matters most on a redirect gateway.
   *
   * We submit `total_amount` when opening the session, but the payer spends the
   * intervening minutes on somebody else's domain, and the callback that comes
   * back is a public endpoint anyone can POST to. If the gateway reports what
   * was actually paid, that figure — not our own expectation, and not the
   * callback body — is the thing to check the row against.
   *
   * A mismatch is NOT a failed payment: money may well have moved. It is a
   * payment we refuse to act on automatically, recorded loudly for a human.
   */
  if (verification.status === "succeeded" && verification.amount != null) {
    const expected = Number(target.amount);
    const paid = verification.amount;
    const currencyMismatch =
      verification.currency != null && verification.currency !== target.currency;

    // Tolerance of one poisha absorbs the gateway's decimal formatting without
    // admitting a meaningful shortfall.
    if (Math.abs(paid - expected) > 0.01 || currencyMismatch) {
      logger.error("payment amount mismatch — refusing to settle", {
        paymentId: target.id,
        expected,
        paid,
        expectedCurrency: target.currency,
        paidCurrency: verification.currency,
      });
      await db
        .update(t.payments)
        .set({
          failureReason: "amount_mismatch",
          providerStatusRaw: `mismatch:${paid}${verification.currency ?? ""}`,
          updatedAt: new Date(),
        })
        .where(eq(t.payments.id, target.id));

      await audit({
        action: "payment.webhook",
        requestId: context.requestId,
        resourceType: "payment",
        resourceId: target.id,
        outcome: "denied",
        metadata: { provider: provider.name, reason: "amount_mismatch", expected, paid },
      });
      return { handled: false, reason: "amount_mismatch" };
    }
  }

  const updated = await db
    .update(t.payments)
    .set({
      status: verification.status,
      webhookVerifiedAt: new Date(),
      providerStatusRaw: verification.status,
      updatedAt: new Date(),
    })
    .where(eq(t.payments.id, target.id))
    .returning({ id: t.payments.id, appointmentId: t.payments.appointmentId });

  if (!updated[0]) return { handled: false, reason: "unknown_payment" };

  await db
    .update(t.paymentWebhookEvents)
    .set({ paymentId: updated[0].id, processedAt: new Date() })
    .where(eq(t.paymentWebhookEvents.id, recorded[0].id));

  await audit({
    action: "payment.webhook",
    requestId: context.requestId,
    resourceType: "payment",
    resourceId: updated[0].id,
    metadata: { provider: provider.name, status: verification.status },
  });

  return { handled: true };
}

/** A payment's status, scoped to the payer. */
export async function getPayment(
  principal: Principal & { patientId: string },
  paymentId: string,
): Promise<PaymentView> {
  const rows = await getDb()
    .select()
    .from(t.payments)
    .where(and(eq(t.payments.id, paymentId), eq(t.payments.patientId, principal.patientId)))
    .limit(1);

  const payment = rows[0];
  if (!payment) throw new AppError("NOT_FOUND");

  return toView(payment);
}

/**
 * Settle from the payer's own return to our origin.
 *
 * SSLCommerz posts the browser back to `success_url` with a `val_id`, and also
 * sends an IPN. Either can arrive first, and on a cold serverless function the
 * IPN can be the slower one — which would leave the payer staring at "pending"
 * for a payment that has already gone through.
 *
 * This is NOT trusting the browser. The `val_id` in the returned form is just a
 * lookup key; what settles the payment is the server-to-server validation call
 * that follows, and a forged val_id gets no answer from SSLCommerz. The result
 * goes through the same `settleVerified` path as the IPN, so a race between the
 * two is resolved by the event-id replay guard rather than by whoever wins.
 */
export async function settleFromReturn(
  valId: string,
  context: { requestId?: string },
): Promise<{ handled: boolean; reason?: string }> {
  const provider = getPaymentProvider();

  if (!provider.validateByValId) {
    return { handled: false, reason: "provider_has_no_validation" };
  }

  const verification = await provider.validateByValId(valId);

  if (!verification.valid) {
    logger.warn("rejected a payment return that did not validate", {
      provider: provider.name,
      reason: verification.reason,
    });
    await audit({
      action: "payment.return",
      requestId: context.requestId,
      outcome: "denied",
      metadata: { provider: provider.name, reason: verification.reason },
    });
    return { handled: false, reason: verification.reason ?? "not_validated" };
  }

  return settleVerified(verification, context);
}
