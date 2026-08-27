/**
 * Niramoy — payment orchestration
 * -----------------------------------------------------------------------------
 * The invariant: a payment reaches `succeeded` only because a verified webhook
 * said so, or because the mock provider is in use and everything is labelled as
 * such. There is no endpoint a client can call to declare their own payment
 * successful.
 */

import { and, eq } from "drizzle-orm";

import { audit } from "../audit";
import { getDb } from "../db/client";
import * as t from "../db/schema";
import { isUniqueViolation } from "../db/errors";
import { AppError } from "../errors";
import { logger } from "../observability/logger";
import { getPaymentProvider, type PaymentStatus } from "../payments/provider";
import type { Principal } from "../security/authz";

export interface PaymentView {
  id: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  provider: string;
  isMock: boolean;
  redirectUrl: string | null;
}

/**
 * Start a payment for an appointment.
 *
 * The amount comes from the APPOINTMENT ROW, never from the request. A
 * client-supplied amount is how someone pays ৳1 for a ৳1,200 consultation.
 */
export async function startPayment(
  principal: Principal & { patientId: string },
  input: { appointmentId?: unknown; idempotencyKey?: unknown },
  context: { requestId?: string; appUrl: string },
): Promise<PaymentView> {
  const db = getDb();
  const provider = getPaymentProvider();

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

  // Client-supplied, so a retried request cannot double-charge.
  const idempotencyKey = String(input.idempotencyKey ?? "") || `appt:${appointment.id}`;

  const existing = await db
    .select()
    .from(t.payments)
    .where(eq(t.payments.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existing[0]) {
    return {
      id: existing[0].id,
      status: existing[0].status as PaymentStatus,
      amount: Number(existing[0].amount),
      currency: existing[0].currency,
      provider: existing[0].provider,
      isMock: existing[0].isMock === "true",
      redirectUrl: null,
    };
  }

  const amount = Number(appointment.feeAmount);

  const intent = await provider.createPayment({
    amount,
    currency: appointment.currency,
    reference: appointment.reference,
    description: `Niramoy consultation ${appointment.reference}`,
    returnUrl: `${context.appUrl}/appointments`,
    idempotencyKey,
  });

  let paymentId: string;
  try {
    const inserted = await db
      .insert(t.payments)
      .values({
        appointmentId: appointment.id,
        patientId: principal.patientId,
        payerUserId: principal.userId,
        provider: provider.name,
        isMock: provider.isMock ? "true" : "false",
        providerPaymentId: intent.providerPaymentId,
        amount: String(amount),
        currency: appointment.currency,
        // A real provider's intent starts pending regardless of what it claims;
        // only a verified webhook advances it.
        status: provider.isMock ? intent.status : "pending",
        idempotencyKey,
      })
      .returning({ id: t.payments.id });
    paymentId = inserted[0]!.id;
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Lost a race with an identical request; return the winner.
      const again = await db
        .select()
        .from(t.payments)
        .where(eq(t.payments.idempotencyKey, idempotencyKey))
        .limit(1);
      if (again[0]) paymentId = again[0].id;
      else throw err;
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
    metadata: { provider: provider.name, isMock: provider.isMock, amount },
  });

  return {
    id: paymentId,
    status: provider.isMock ? intent.status : "pending",
    amount,
    currency: appointment.currency,
    provider: provider.name,
    isMock: provider.isMock,
    redirectUrl: intent.redirectUrl,
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

  const updated = await db
    .update(t.payments)
    .set({
      status: verification.status,
      webhookVerifiedAt: new Date(),
      providerStatusRaw: verification.status,
    })
    .where(
      and(
        eq(t.payments.provider, provider.name),
        eq(t.payments.providerPaymentId, verification.providerPaymentId),
      ),
    )
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

  return {
    id: payment.id,
    status: payment.status as PaymentStatus,
    amount: Number(payment.amount),
    currency: payment.currency,
    provider: payment.provider,
    isMock: payment.isMock === "true",
    redirectUrl: null,
  };
}
