/**
 * Niramoy — payments
 * -----------------------------------------------------------------------------
 * A provider interface with a clearly-labelled mock as the default.
 *
 * The brief is emphatic that mocked payments must not be dressed up as real
 * ones, and the existing UI already says "payment is mocked for this MVP". That
 * copy stays accurate: `MockPaymentProvider.isMock` is true, it is stored on the
 * payment row, and it is returned to the client so the interface can keep saying
 * so.
 *
 * The rules that hold regardless of provider:
 *
 *   - A payment is `succeeded` because a SIGNED WEBHOOK said so, never because a
 *     browser did. The client cannot move a payment to succeeded through any
 *     endpoint here.
 *   - Webhook signatures are verified in constant time before the body is
 *     trusted for anything.
 *   - Every webhook event id is recorded, so a replayed event is a no-op.
 *   - No card data is stored, ever. bKash and Nagad are mobile-wallet flows and
 *     no card number should reach this system at all.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { getEnv } from "../config/env";
import { AppError } from "../errors";
import { logger } from "../observability/logger";

export type PaymentStatus =
  | "pending"
  | "authorized"
  | "succeeded"
  | "failed"
  | "refunded"
  | "cancelled";

export interface CreatePaymentInput {
  amount: number;
  currency: string;
  reference: string;
  description: string;
  /** Where the wallet returns the payer afterwards. */
  returnUrl: string;
  idempotencyKey: string;
}

export interface PaymentIntent {
  providerPaymentId: string;
  status: PaymentStatus;
  /** Where to send the payer. Null for the mock, which redirects nowhere. */
  redirectUrl: string | null;
  isMock: boolean;
}

export interface WebhookVerification {
  valid: boolean;
  eventId: string | null;
  providerPaymentId: string | null;
  status: PaymentStatus | null;
  reason?: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly isMock: boolean;
  createPayment(input: CreatePaymentInput): Promise<PaymentIntent>;
  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus>;
  refundPayment(input: { providerPaymentId: string; amount: number }): Promise<PaymentStatus>;
  /** Verify a webhook before ANY of its content is believed. */
  verifyWebhook(input: { rawBody: string; headers: Headers }): Promise<WebhookVerification>;
}

/* -------------------------------------------------------------------------- */
/* Mock                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The default. NOTHING IS CHARGED.
 *
 * It moves a payment straight to `succeeded` so a demo booking completes, and
 * marks it `isMock` at every layer so no part of the system or the UI can
 * mistake it for a real transaction. The schema permits `succeeded` without a
 * verified webhook only when is_mock is true — see ck_payments_succeeded_verified.
 */
const mockProvider: PaymentProvider = {
  name: "mock",
  isMock: true,

  async createPayment(input) {
    logger.info("mock payment created — nothing is charged", {
      reference: input.reference,
      amount: input.amount,
    });
    return {
      providerPaymentId: `mock_${input.idempotencyKey}`,
      status: "succeeded",
      redirectUrl: null,
      isMock: true,
    };
  },

  async getPaymentStatus() {
    return "succeeded";
  },

  async refundPayment() {
    return "refunded";
  },

  async verifyWebhook() {
    // The mock issues no webhooks, so anything claiming to be one is not.
    return { valid: false, eventId: null, providerPaymentId: null, status: null, reason: "mock_provider_has_no_webhooks" };
  },
};

/* -------------------------------------------------------------------------- */
/* Signature verification                                                      */
/* -------------------------------------------------------------------------- */

/** Constant-time HMAC comparison. A plain === leaks the signature's prefix. */
function signatureMatches(rawBody: string, supplied: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(supplied.replace(/^sha256=/, ""), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/* -------------------------------------------------------------------------- */
/* bKash / Nagad scaffolding                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Structure for a real mobile-financial-service integration.
 *
 * NOT CONNECTED. The request shapes below follow the published patterns for
 * these gateways, but no live integration has been tested, and neither the
 * merchant agreement nor the Bangladesh Bank authorisation that a real
 * integration requires is in place — see docs/REGULATORY_ASSUMPTIONS.md A7.
 *
 * What IS complete and correct here is the part that matters for safety:
 * signature verification, idempotency, and the rule that only a verified
 * webhook can move a payment to succeeded.
 */
function mfsProvider(
  name: "bkash" | "nagad",
  config: { apiKey: string; apiSecret: string; webhookSecret: string | undefined },
): PaymentProvider {
  return {
    name,
    isMock: false,

    async createPayment(): Promise<PaymentIntent> {
      throw new AppError("PROVIDER_UNAVAILABLE", {
        message: "Online payment isn't available yet.",
        meta: {
          provider: name,
          reason: "integration_not_connected",
          note: "Requires a merchant agreement and Bangladesh Bank authorisation.",
        },
      });
    },

    async getPaymentStatus(): Promise<PaymentStatus> {
      throw new AppError("PROVIDER_UNAVAILABLE", { meta: { provider: name } });
    },

    async refundPayment(): Promise<PaymentStatus> {
      throw new AppError("PROVIDER_UNAVAILABLE", { meta: { provider: name } });
    },

    /**
     * Implemented for real, because it is the security-critical half and it is
     * testable without a merchant account.
     */
    async verifyWebhook({ rawBody, headers }) {
      if (!config.webhookSecret) {
        return { valid: false, eventId: null, providerPaymentId: null, status: null, reason: "no_webhook_secret" };
      }

      const supplied = headers.get("x-signature") ?? headers.get("x-hub-signature-256") ?? "";
      if (!supplied) {
        return { valid: false, eventId: null, providerPaymentId: null, status: null, reason: "missing_signature" };
      }
      if (!signatureMatches(rawBody, supplied, config.webhookSecret)) {
        return { valid: false, eventId: null, providerPaymentId: null, status: null, reason: "bad_signature" };
      }

      let body: { eventId?: unknown; paymentID?: unknown; transactionStatus?: unknown };
      try {
        body = JSON.parse(rawBody) as typeof body;
      } catch {
        return { valid: false, eventId: null, providerPaymentId: null, status: null, reason: "malformed_body" };
      }

      const STATUS_MAP: Record<string, PaymentStatus> = {
        Completed: "succeeded",
        Success: "succeeded",
        Authorized: "authorized",
        Failed: "failed",
        Cancelled: "cancelled",
        Refunded: "refunded",
      };

      return {
        valid: true,
        eventId: body.eventId ? String(body.eventId) : null,
        providerPaymentId: body.paymentID ? String(body.paymentID) : null,
        // An unrecognised status is NOT optimistically treated as success.
        status: STATUS_MAP[String(body.transactionStatus ?? "")] ?? null,
      };
    },
  };
}

/* -------------------------------------------------------------------------- */

let cached: PaymentProvider | undefined;

export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;
  const env = getEnv();

  if ((env.paymentProvider === "bkash" || env.paymentProvider === "nagad") &&
      env.PAYMENT_API_KEY && env.PAYMENT_API_SECRET) {
    cached = mfsProvider(env.paymentProvider, {
      apiKey: env.PAYMENT_API_KEY,
      apiSecret: env.PAYMENT_API_SECRET,
      webhookSecret: env.PAYMENT_WEBHOOK_SECRET,
    });
  } else {
    cached = mockProvider;
  }
  return cached;
}

export function resetPaymentProvider(): void {
  cached = undefined;
}

export { signatureMatches };
