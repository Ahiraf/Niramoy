/**
 * GET /api/admin/diagnostics — is this deployment configured the way you think?
 *
 * The failure this exists to catch: a credential that is wrong, or a callback
 * URL pointing at localhost, does not throw at boot. It fails at the moment a
 * patient — or an examiner — is watching the checkout, and it fails looking
 * like a network problem rather than a configuration one.
 *
 * Two rules govern what it may say:
 *
 *   1. NO SECRETS. Not the store password, not the session secret, not a
 *      prefix, not a hash, not a length. A diagnostic endpoint is exactly the
 *      kind of thing that gets left reachable, so it reports whether a value is
 *      PRESENT and never what it is. The one identifier shown in full is the
 *      SSLCommerz store id, which is the merchant's public name at the gateway
 *      and is useless without the password.
 *
 *   2. Admin only. Even without secrets, this maps the deployment's
 *      dependencies, and that is reconnaissance.
 *
 * It makes no outbound calls. Probing the gateway for real opens a payment
 * session, which is `npm run pay:check` and deliberately not a GET endpoint.
 */
import { ok, withRoute } from "../../../../lib/api/respond";
import { getEnv } from "../../../../lib/config/env";
import { getPaymentProvider } from "../../../../lib/payments/provider";
import { requireAdmin } from "../../../../lib/security/authz";
import { getVideoProvider } from "../../../../lib/video/provider";

export const dynamic = "force-dynamic";

/** A finding worth a deployer's attention, in plain words. */
interface Warning {
  area: string;
  message: string;
}

export const GET = withRoute("GET /api/admin/diagnostics", async (request) => {
  await requireAdmin(request);

  const env = getEnv();
  const payment = getPaymentProvider();
  const video = getVideoProvider();
  const warnings: Warning[] = [];

  const appUrl = new URL(env.APP_URL);
  const httpsAppUrl = appUrl.protocol === "https:";
  const localAppUrl = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(appUrl.hostname);

  /*
   * APP_URL is the single most consequential string in a deployed build: every
   * SSLCommerz callback, the IPN, and the CSRF origin pin are all derived from
   * it. Wrong here means the gateway posts settlement to a host that does not
   * exist, and the payment sits pending forever with nothing in any log to say
   * why.
   */
  if (!env.appUrlConfigured) {
    warnings.push({
      area: "app_url",
      message:
        "APP_URL is not set, so it has defaulted to localhost. Payment callbacks and " +
        "the IPN will be sent to an address SSLCommerz cannot reach.",
    });
  } else if (localAppUrl) {
    warnings.push({
      area: "app_url",
      message:
        `APP_URL points at ${appUrl.host}. SSLCommerz cannot deliver an IPN there, so ` +
        "a completed payment will stay pending.",
    });
  } else if (!httpsAppUrl) {
    warnings.push({
      area: "app_url",
      message:
        "APP_URL is not https. Camera and microphone access is refused on insecure " +
        "origins, so video consultations will not start.",
    });
  }

  if (payment.name === "mock") {
    warnings.push({
      area: "payments",
      message:
        "The mock payment provider is in use — nothing reaches bKash. Set " +
        "SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD to use the real gateway.",
    });
  }
  if (env.PAYMENT_PROVIDER === "bkash" || env.PAYMENT_PROVIDER === "nagad") {
    warnings.push({
      area: "payments",
      message:
        `PAYMENT_PROVIDER=${env.PAYMENT_PROVIDER} is unconnected scaffolding and refuses ` +
        "every checkout. Leave PAYMENT_PROVIDER unset to select SSLCommerz automatically.",
    });
  }
  if (payment.name === "sslcommerz" && !payment.sandbox) {
    warnings.push({
      area: "payments",
      message: "The LIVE SSLCommerz gateway is configured. Real money will move.",
    });
  }

  if (video.name === "demo") {
    warnings.push({
      area: "video",
      message:
        "No video provider is configured, so consultation rooms carry no media. Set " +
        "VIDEO_PROVIDER=jitsi for a real two-way call.",
    });
  }
  if (video.name === "jitsi-public") {
    warnings.push({
      area: "video",
      message:
        "Public Jitsi rooms are unlisted, not access-controlled: anyone holding the " +
        "room URL can enter. Acceptable for a marked demonstration only.",
    });
  }
  if (env.demoMode) {
    warnings.push({
      area: "demo_mode",
      message:
        "DEMO_MODE=true — consultation rooms open outside their appointment window. " +
        "Who may join is unaffected. Turn this off for real use.",
    });
  }
  if (env.databaseDriver === "pglite") {
    warnings.push({
      area: "database",
      message: "Running on the in-process PGlite database. Nothing written here survives a deploy.",
    });
  }
  if (env.emailProvider === "console") {
    warnings.push({
      area: "email",
      message:
        "Email is logged, not sent. Verification and password-reset links will never " +
        "reach an inbox.",
    });
  }
  if (env.smsProvider === "console") {
    warnings.push({
      area: "sms",
      message: "SMS is logged, not sent. Sign-up codes will never reach a handset.",
    });
  }

  return ok({
    appEnv: env.APP_ENV,
    appUrl: {
      value: env.APP_URL,
      configured: env.appUrlConfigured,
      https: httpsAppUrl,
      /** What SSLCommerz is told to call back on. Derived, never configured separately. */
      callbacks: {
        success: `${env.APP_URL}/api/payments/return/success`,
        fail: `${env.APP_URL}/api/payments/return/fail`,
        cancel: `${env.APP_URL}/api/payments/return/cancel`,
        ipn: `${env.APP_URL}/api/payments/webhook`,
      },
    },
    payments: {
      provider: payment.name,
      flow: payment.flow,
      isMock: payment.isMock,
      sandbox: payment.sandbox,
      // The merchant's public name at the gateway. The password is never
      // reported in any form, including whether it is long enough.
      storeId: env.SSLCOMMERZ_STORE_ID ?? null,
      storePasswordPresent: Boolean(env.SSLCOMMERZ_STORE_PASSWORD),
    },
    video: {
      provider: video.name,
      credentialsPresent: Boolean(env.VIDEO_API_KEY && env.VIDEO_API_SECRET),
      publicRoomAcknowledged: env.allowPublicVideoRoom,
    },
    scheduling: { displayTimezone: env.DISPLAY_TIMEZONE },
    demoMode: env.demoMode,
    database: { driver: env.databaseDriver, configured: Boolean(env.databaseUrl) },
    messaging: { email: env.emailProvider, sms: env.smsProvider },
    warnings,
  });
});
