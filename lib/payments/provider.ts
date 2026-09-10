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
import { sslcommerzProvider } from "./sslcommerz";

export type PaymentStatus =
  | "pending"
  | "authorized"
  | "succeeded"
  | "failed"
  | "refunded"
  | "cancelled";

/**
 * The instrument the patient chose, which is not the same thing as the gateway.
 * `cash` never reaches a provider at all — it is settled at the chamber.
 */
export type PaymentMethod = "bkash" | "cash";

export interface CreatePaymentInput {
  amount: number;
  currency: string;
  reference: string;
  description: string;
  method: PaymentMethod;
  /** Where the wallet returns the payer afterwards. */
  returnUrl: string;
  idempotencyKey: string;
}

/**
 * Confirming a wallet payment the payer has authorised.
 *
 * Note what is NOT in here: a PIN. In bKash's tokenized checkout the payer
 * authenticates on bKash's own hosted page and the merchant never sees the
 * credential. A page on our origin asking for a bKash PIN is precisely the
 * shape of a phishing screen, so neither the live path nor the sandbox has a
 * field for one — see the note on the sandbox flow below.
 */
export interface ExecutePaymentInput {
  providerPaymentId: string;
  /** The payer's wallet number, for display and reconciliation only. */
  walletNumber: string;
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
  /**
   * What the gateway says was ACTUALLY paid, when it says so.
   *
   * Returned so the service can compare it against the stored row before
   * believing a success. A callback naming a real transaction but a smaller
   * amount is the standard tampering case against a redirect gateway, and the
   * amount is the only thing that catches it. Null means the provider did not
   * report one, which is not the same as "it matched".
   */
  amount?: number | null;
  currency?: string | null;
  reason?: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly isMock: boolean;
  /**
   * How the payer authorises.
   *
   * `two-step` is the tokenized-checkout shape: create, then execute once the
   * payer has authorised, both from our origin. `redirect` sends the payer to
   * the gateway's own hosted page and there is no execute call at all — the
   * service must not offer a confirm button for one, because pressing it could
   * not do anything.
   */
  readonly flow: "two-step" | "redirect";
  /** True when the gateway is real but the money is not. Surfaced in the UI. */
  readonly sandbox: boolean;
  createPayment(input: CreatePaymentInput): Promise<PaymentIntent>;
  /**
   * Confirm a payment the payer has authorised on the wallet's side. Separate
   * from createPayment because tokenized checkout really is two calls with the
   * payer's authorisation in between, and collapsing them would let a browser
   * complete a payment on its own say-so.
   */
  executePayment(input: ExecutePaymentInput): Promise<{ status: PaymentStatus; reason?: string }>;
  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus>;
  refundPayment(input: { providerPaymentId: string; amount: number }): Promise<PaymentStatus>;
  /** Verify a webhook before ANY of its content is believed. */
  verifyWebhook(input: { rawBody: string; headers: Headers }): Promise<WebhookVerification>;
  /**
   * Settle directly from a gateway-issued validation id, for providers whose
   * browser return carries one. Lets a payer who is looking at the screen see
   * the result without waiting on the IPN, using the same server-to-server
   * check — it is a second route to the same authority, not a shortcut past it.
   */
  validateByValId?(valId: string): Promise<WebhookVerification>;
}

/* -------------------------------------------------------------------------- */
/* Mock                                                                        */
/* -------------------------------------------------------------------------- */

/** A bKash wallet number: an 11-digit Bangladeshi mobile number. */
const BD_WALLET = /^01[3-9]\d{8}$/;

export function isWalletNumber(value: string): boolean {
  return BD_WALLET.test(value.replace(/[\s-]/g, ""));
}

/**
 * The default. NOTHING IS CHARGED.
 *
 * It walks the same two-step shape as bKash's tokenized checkout — create, then
 * execute once the payer has authorised — rather than jumping straight to
 * `succeeded`. That is not ceremony: the two-step is what makes it impossible
 * for a browser to complete a payment in a single call it controls end to end,
 * and a demo that skips it would be exercising a code path the live integration
 * does not have.
 *
 * What it deliberately does NOT do is ask for a bKash PIN. On the live flow the
 * payer is redirected to bKash's own hosted page and authenticates there; the
 * merchant never sees the credential. A sandbox that put a PIN field on a
 * Niramoy page would be teaching patients to type their wallet PIN into
 * whatever site asks, which is the exact habit that makes MFS phishing work.
 * The sandbox takes the wallet number and nothing secret.
 *
 * `isMock` is true at every layer so no part of the system or the UI can
 * mistake this for a real transaction. The schema permits `succeeded` without a
 * verified webhook only when is_mock is true — see ck_payments_succeeded_verified.
 */
const mockProvider: PaymentProvider = {
  name: "mock",
  isMock: true,
  flow: "two-step",
  sandbox: true,

  async createPayment(input) {
    logger.info("sandbox payment created — nothing is charged", {
      reference: input.reference,
      amount: input.amount,
      method: input.method,
    });
    return {
      providerPaymentId: `mock_${input.idempotencyKey}`,
      // Pending, not succeeded: the payer has not authorised anything yet.
      status: "pending",
      // A live wallet would send the payer to its own hosted page. The sandbox
      // has none, so the client renders an in-app sheet that says as much.
      redirectUrl: null,
      isMock: true,
    };
  },

  async executePayment({ walletNumber }) {
    // The one thing worth validating in a sandbox: that the demo cannot be
    // driven with a number no wallet could ever have.
    if (!isWalletNumber(walletNumber)) {
      return { status: "failed", reason: "invalid_wallet_number" };
    }
    logger.info("sandbox payment executed — nothing is charged", {
      wallet: `${walletNumber.slice(0, 5)}******`,
    });
    return { status: "succeeded" };
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
    flow: "two-step",
    sandbox: false,

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

    async executePayment(): Promise<{ status: PaymentStatus }> {
      throw new AppError("PROVIDER_UNAVAILABLE", {
        message: "Online payment isn't available yet.",
        meta: { provider: name, reason: "integration_not_connected" },
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

  /*
   * SSLCommerz first: it is the one that actually reaches bKash. Both
   * credentials are required together — env.ts refuses a half-configured
   * gateway rather than letting it fall through to the mock, because a mock
   * that quietly stands in for a gateway you asked for is indistinguishable
   * from a working integration right up until it matters.
   */
  if (env.paymentProvider === "sslcommerz" && env.SSLCOMMERZ_STORE_ID && env.SSLCOMMERZ_STORE_PASSWORD) {
    cached = sslcommerzProvider({
      storeId: env.SSLCOMMERZ_STORE_ID,
      storePassword: env.SSLCOMMERZ_STORE_PASSWORD,
      sandbox: env.sslcommerzSandbox,
      appUrl: env.APP_URL,
    });
    return cached;
  }

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
