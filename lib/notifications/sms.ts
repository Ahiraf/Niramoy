/**
 * Niramoy — SMS providers
 * -----------------------------------------------------------------------------
 * The same shape as the email providers next door: an interface, a console
 * implementation that is honest about not sending anything, and one real
 * gateway that switches on when credentials exist.
 *
 * The gateway is TextBee — an Android handset with a Bangladeshi SIM, driven by
 * a small app, relaying messages posted to its API. That is a deliberate choice
 * for this platform rather than a shortcut: an operator-issued A2P route in
 * Bangladesh needs a registered company, a masking approval and a per-message
 * contract, none of which a university project can hold, and a foreign
 * aggregator delivering to a Bangladeshi handset is expensive and unreliable
 * enough that patients would miss codes. A handset sends from an ordinary
 * 01XXXXXXXXX number, which is also what a patient here expects to receive.
 *
 * The honesty rule from providers.ts carries over unchanged: `delivered` is
 * only ever true when something actually left. The console provider reports
 * `delivered: false`, so nothing upstream can record a delivery that did not
 * happen — a verification code that appears to send and does not is an account
 * the person cannot finish creating.
 */

import { getEnv } from "../config/env";
import { logger } from "../observability/logger";

export interface SmsMessage {
  /** E.164. Normalise with lib/auth/phone before calling. */
  to: string;
  /** Plain GSM-safe text where possible; Bangla is sent as UCS-2 by the phone. */
  text: string;
}

export interface SmsResult {
  /** The gateway accepted the message for delivery by the handset. */
  delivered: boolean;
  id?: string;
  /** Set when delivery was not attempted, e.g. no gateway is configured. */
  reason?: string;
}

export interface SmsProvider {
  readonly name: string;
  /** True when a real gateway is behind this provider. */
  readonly canDeliver: boolean;
  send(message: SmsMessage): Promise<SmsResult>;
}

/**
 * The default. Logs that a message was requested and, outside production and
 * test, prints it so a developer can read the code out of their terminal and
 * complete a sign-up with no gateway account.
 *
 * The recipient is logged; the body is not, because the body is a working
 * verification code.
 */
const consoleSmsProvider: SmsProvider = {
  name: "console",
  canDeliver: false,
  async send(message) {
    const env = getEnv();
    logger.info("sms (console provider)", { to: message.to });
    if (!env.isProd && !env.isTest) {
      process.stdout.write(`\n--- sms to ${message.to} ---\n${message.text}\n---\n\n`);
    }
    return { delivered: false, reason: "no_sms_provider" };
  },
};

const TEXTBEE_DEFAULT_BASE_URL = "https://api.textbee.dev/api/v1";

/**
 * TextBee.
 *
 * TextBee's account-level endpoint accepts an optional deviceId and SIM
 * subscription in the request body. The older device-scoped endpoint still
 * exists, but is deprecated and does not make it possible to select a SIM.
 */
function textbeeProvider(config: {
  apiKey: string;
  deviceId?: string;
  simSubscriptionId?: number;
  baseUrl: string;
}): SmsProvider {
  const url = `${config.baseUrl}/gateway/send-sms`;

  return {
    name: "textbee",
    canDeliver: true,
    async send(message) {
      // A handset on a mobile network is slower than an HTTP API and a hung
      // request would hold a sign-up open; give up and let the caller retry.
      const res = await fetch(url, {
        method: "POST",
        headers: { "x-api-key": config.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: [message.to],
          message: message.text,
          ...(config.deviceId ? { deviceId: config.deviceId } : {}),
          ...(config.simSubscriptionId !== undefined
            ? { simSubscriptionId: config.simSubscriptionId }
            : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        // The body can carry a gateway-side reason ("device offline"), which is
        // exactly what an operator needs and never safe to show a patient.
        const detail = await res.text().catch(() => "");
        throw new Error(`textbee responded ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
      }

      const body = (await res.json().catch(() => ({}))) as {
        data?: {
          success?: boolean;
          message?: string;
          smsBatchId?: string;
          successCount?: number;
          failureCount?: number;
        };
      };
      const result = body.data;
      const id = result?.smsBatchId;
      const successCount = result?.successCount ?? 0;
      const failureCount = result?.failureCount ?? 0;

      /*
       * TextBee returns HTTP 200 both for an accepted queue entry and for an
       * immediate dispatch result. A 200 alone is not enough: the device can
       * report failureCount > 0, which is exactly what Android displays as a
       * red "Failed" message. Surface that as a provider failure so the OTP
       * route does not leave a live code that nobody received.
       */
      const accepted = result?.success === true || Boolean(id) || successCount > 0;
      const failed = failureCount > 0 && successCount === 0 && !id;
      if (!accepted || failed) {
        logger.warn("textbee handset rejected SMS", {
          failureCount,
          reason: result?.message ?? "unrecognised_gateway_result",
        });
        return { delivered: false, reason: "textbee_handset_failed" };
      }

      return { delivered: true, ...(id ? { id } : {}) };
    },
  };
}

let cached: SmsProvider | undefined;

export function getSmsProvider(): SmsProvider {
  if (cached) return cached;
  const env = getEnv();
  cached =
    env.smsProvider === "textbee" && env.TEXTBEE_API_KEY
      ? textbeeProvider({
          apiKey: env.TEXTBEE_API_KEY,
          ...(env.TEXTBEE_DEVICE_ID ? { deviceId: env.TEXTBEE_DEVICE_ID } : {}),
          ...(env.TEXTBEE_SIM_SUBSCRIPTION_ID !== undefined
            ? { simSubscriptionId: env.TEXTBEE_SIM_SUBSCRIPTION_ID }
            : {}),
          baseUrl: env.TEXTBEE_BASE_URL ?? TEXTBEE_DEFAULT_BASE_URL,
        })
      : consoleSmsProvider;
  return cached;
}

export function resetSmsProvider(): void {
  cached = undefined;
}
