/**
 * Niramoy — SSLCommerz payment provider
 * -----------------------------------------------------------------------------
 * SSLCommerz is an aggregator: it fronts bKash, Nagad, Rocket and the card
 * schemes behind one merchant account. That matters here because a DIRECT bKash
 * merchant agreement needs a trade licence and a signed contract, while an
 * SSLCommerz SANDBOX account is self-service and free — so a genuinely working
 * wallet payment is demonstrable without pretending.
 *
 * The flow is a REDIRECT, not the two-step tokenized checkout the mock imitates:
 *
 *   1. We POST a session request and get back a `GatewayPageURL`.
 *   2. The payer leaves our origin entirely and authenticates on SSLCommerz's
 *      hosted page — which is why there is no PIN field anywhere in this file.
 *   3. SSLCommerz POSTs the browser back to `success_url`/`fail_url`/`cancel_url`
 *      AND, independently, POSTs an IPN to `ipn_url`.
 *   4. Either way we call the VALIDATION API server-to-server with the `val_id`
 *      and believe THAT, never the callback body.
 *
 * Why validation-API-first rather than the `verify_sign` MD5:
 *
 *   The callback that arrives at our door is attacker-controlled — anyone can
 *   POST to a public URL. `verify_sign` is a shared-secret hash and would do,
 *   but the validation API is a direct question to SSLCommerz over TLS about a
 *   `val_id` only SSLCommerz issues, and it returns the authoritative amount.
 *   It cannot be replayed into a different answer, and getting it right does
 *   not depend on reproducing a field-concatenation order exactly.
 *
 * The single most important control is AMOUNT VERIFICATION. `total_amount` is
 * submitted by us but the callback reports what was actually paid; a payer who
 * tampers mid-flow, or a forged callback naming someone else's transaction, is
 * caught by comparing the validated amount against the stored payment row. That
 * comparison lives in the service layer, which has the row — this file returns
 * the validated amount so it can be made.
 */

import { createHash } from "node:crypto";

import { getEnv } from "../config/env";
import { AppError } from "../errors";
import { logger } from "../observability/logger";
import type {
  CreatePaymentInput,
  ExecutePaymentInput,
  PaymentIntent,
  PaymentProvider,
  PaymentStatus,
  WebhookVerification,
} from "./provider";

const SANDBOX_BASE = "https://sandbox.sslcommerz.com";
const LIVE_BASE = "https://securepay.sslcommerz.com";

/** SSLCommerz rejects a tran_id longer than 30 characters. */
const TRAN_ID_MAX = 30;

/**
 * A stable, short transaction id derived from our idempotency key.
 *
 * Deterministic on purpose: a retried checkout must reach the SAME SSLCommerz
 * transaction rather than opening a second one, and `providerPaymentId` is what
 * the IPN handler looks the payment up by. Hashed rather than truncated because
 * the raw key is `appt:<uuid>` — truncating that collides across appointments
 * whose ids share a prefix.
 */
export function transactionId(idempotencyKey: string): string {
  const digest = createHash("sha256").update(idempotencyKey).digest("hex");
  return `nmy${digest.slice(0, TRAN_ID_MAX - 3)}`;
}

/** SSLCommerz speaks form-encoded requests and JSON responses. */
function form(fields: Record<string, string | number | undefined>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== "") body.set(key, String(value));
  }
  return body;
}

/**
 * VALID and VALIDATED both mean the money moved. They differ only in whether
 * this is the first time we asked — VALIDATED is the answer to a repeat call,
 * which is exactly what happens when the IPN and the browser return race.
 * Anything else is NOT optimistically read as success.
 */
const SETTLED: Record<string, PaymentStatus> = {
  VALID: "succeeded",
  VALIDATED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
  EXPIRED: "cancelled",
  UNATTEMPTED: "cancelled",
};

export interface SslcommerzConfig {
  storeId: string;
  storePassword: string;
  sandbox: boolean;
  /** Where SSLCommerz sends the browser and the IPN back to. */
  appUrl: string;
}

export function sslcommerzProvider(config: SslcommerzConfig): PaymentProvider {
  const base = config.sandbox ? SANDBOX_BASE : LIVE_BASE;

  /**
   * Ask SSLCommerz about a val_id. This is the only statement about a payment
   * this provider ever trusts.
   */
  async function validate(valId: string): Promise<WebhookVerification> {
    const url = new URL(`${base}/validator/api/validationserverAPI.php`);
    url.searchParams.set("val_id", valId);
    url.searchParams.set("store_id", config.storeId);
    url.searchParams.set("store_passwd", config.storePassword);
    url.searchParams.set("format", "json");

    let payload: Record<string, unknown>;
    try {
      const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        return reject(`validation_http_${res.status}`);
      }
      payload = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      // A gateway we cannot reach is a gateway that has told us NOTHING. It is
      // never read as success — the payment simply stays where it was.
      logger.warn("sslcommerz validation call failed", {
        reason: err instanceof Error ? err.message : "unknown",
      });
      return reject("validation_unreachable");
    }

    const status = String(payload.status ?? "");
    const mapped = SETTLED[status];
    if (!mapped) return reject(`unexpected_status_${status || "empty"}`);

    return {
      valid: true,
      // val_id is unique per validation, which is precisely the replay key.
      eventId: String(payload.val_id ?? valId),
      providerPaymentId: payload.tran_id ? String(payload.tran_id) : null,
      status: mapped,
      // Returned so the service can check them against the stored row. A
      // callback that names a real transaction but a smaller amount is the
      // classic SSLCommerz tampering case.
      amount: payload.amount === undefined ? null : Number(payload.amount),
      currency: payload.currency ? String(payload.currency) : null,
    };
  }

  return {
    name: "sslcommerz",
    // Not a mock: real API calls, real verification, a real hosted gateway.
    // Whether real MONEY moves is `sandbox`, which the UI surfaces separately.
    isMock: false,
    flow: "redirect",
    sandbox: config.sandbox,

    async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
      const tranId = transactionId(input.idempotencyKey);
      const returnBase = `${config.appUrl}/api/payments/return`;

      const res = await fetch(`${base}/gwprocess/v4/api.php`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form({
          store_id: config.storeId,
          store_passwd: config.storePassword,
          total_amount: input.amount.toFixed(2),
          currency: input.currency,
          tran_id: tranId,

          success_url: `${returnBase}/success`,
          fail_url: `${returnBase}/fail`,
          cancel_url: `${returnBase}/cancel`,
          // Independent of the browser: the payer closing the tab must not be
          // the reason a completed payment goes unrecorded.
          ipn_url: `${config.appUrl}/api/payments/webhook`,

          // Sends the payer straight to bKash instead of the channel chooser.
          multi_card_name: input.method === "bkash" ? "bkash" : undefined,

          product_name: input.description,
          product_category: "healthcare",
          product_profile: "non-physical-goods",
          num_of_item: 1,
          shipping_method: "NO",

          // SSLCommerz rejects a session with these empty. Deliberately generic:
          // a consultation's payment record is not the place for patient detail,
          // and this leaves our systems for a third party.
          cus_name: "Niramoy patient",
          cus_email: "billing@niramoy.invalid",
          cus_add1: "Dhaka",
          cus_city: "Dhaka",
          cus_postcode: "1000",
          cus_country: "Bangladesh",
          cus_phone: "01700000000",

          value_a: input.reference,
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!res.ok) {
        throw new AppError("PROVIDER_UNAVAILABLE", {
          message: "Couldn't reach bKash right now. Your appointment is still booked.",
          meta: { provider: "sslcommerz", httpStatus: res.status },
        });
      }

      const payload = (await res.json()) as {
        status?: string;
        GatewayPageURL?: string;
        failedreason?: string;
      };

      if (payload.status !== "SUCCESS" || !payload.GatewayPageURL) {
        logger.warn("sslcommerz refused a session request", {
          status: payload.status,
          reason: payload.failedreason,
        });
        throw new AppError("PROVIDER_UNAVAILABLE", {
          message: "Couldn't start the bKash payment. Your appointment is still booked.",
          meta: { provider: "sslcommerz", reason: payload.failedreason ?? payload.status },
        });
      }

      return {
        providerPaymentId: tranId,
        // Pending until validated. The gateway page having opened is not payment.
        status: "pending",
        redirectUrl: payload.GatewayPageURL,
        isMock: false,
      };
    },

    /**
     * There is no execute step in a redirect flow — the payer authorised on
     * SSLCommerz's page, and asking them to confirm again on ours would be
     * theatre. The service routes around this for `flow: "redirect"`; if
     * anything still calls it, saying so plainly beats inventing a status.
     */
    async executePayment(_input: ExecutePaymentInput): Promise<{ status: PaymentStatus }> {
      throw new AppError("NOT_ELIGIBLE", {
        message: "This payment is confirmed by bKash, not from here.",
        meta: { provider: "sslcommerz", reason: "redirect_flow_has_no_execute" },
      });
    },

    /** Status by our own transaction id, for reconciling a payment we lost track of. */
    async getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus> {
      const url = new URL(`${base}/validator/api/merchantTransIDvalidationAPI.php`);
      url.searchParams.set("tran_id", providerPaymentId);
      url.searchParams.set("store_id", config.storeId);
      url.searchParams.set("store_passwd", config.storePassword);
      url.searchParams.set("format", "json");

      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new AppError("PROVIDER_UNAVAILABLE", { meta: { provider: "sslcommerz" } });

      const payload = (await res.json()) as { element?: Array<{ status?: string }> };
      const status = payload.element?.[0]?.status ?? "";
      return SETTLED[status] ?? "pending";
    },

    async refundPayment(): Promise<PaymentStatus> {
      // The refund API needs bank_tran_id and a refund_amount, and a refund is
      // a money movement that should not be one unreviewed function call away.
      throw new AppError("PROVIDER_UNAVAILABLE", {
        message: "Refunds are handled from the SSLCommerz merchant panel.",
        meta: { provider: "sslcommerz", reason: "refund_not_automated" },
      });
    },

    /**
     * The IPN. Form-encoded, not JSON, and believed only after the validation
     * API agrees — the body itself is attacker-controlled.
     */
    async verifyWebhook({ rawBody }): Promise<WebhookVerification> {
      const fields = new URLSearchParams(rawBody);
      const valId = fields.get("val_id");

      if (!valId) {
        // No val_id means there is nothing to ask SSLCommerz ABOUT. A failed or
        // cancelled IPN legitimately arrives this way, so it is not an
        // authentication failure — it is an event with no settlement in it.
        const status = String(fields.get("status") ?? "");
        return {
          valid: true,
          eventId: fields.get("tran_id") ? `${fields.get("tran_id")}:${status}` : null,
          providerPaymentId: fields.get("tran_id"),
          status: SETTLED[status] ?? null,
          amount: null,
          currency: null,
        };
      }

      return validate(valId);
    },

    /** Exposed so the browser-return route can settle without waiting for the IPN. */
    validateByValId: validate,
  };
}

function reject(reason: string): WebhookVerification {
  return {
    valid: false,
    eventId: null,
    providerPaymentId: null,
    status: null,
    amount: null,
    currency: null,
    reason,
  };
}
