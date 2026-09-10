/**
 * npm run pay:check — probe the configured payment gateway.
 *
 * Exists for the same reason ai:check does: a wrong credential is invisible
 * until the moment it matters. A mistyped SSLCommerz store password does not
 * throw at boot — it fails when a patient (or an examiner) is watching the
 * checkout, and the failure looks like a network problem rather than a
 * configuration one.
 *
 * This opens a REAL session against the configured gateway and prints the
 * hosted page URL. Against the sandbox that costs nothing. Against the live
 * gateway it would create a genuine payment session, so it refuses to run
 * there — see the guard below.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env", override: false });

async function main(): Promise<void> {
  const { getEnv } = await import("../lib/config/env");
  const env = getEnv();

  console.log("");
  console.log(`▸ payment provider: ${env.paymentProvider}`);

  if (env.paymentProvider !== "sslcommerz") {
    console.log("");
    console.log("  The mock provider is in use. Nothing to probe: it never leaves the process.");
    console.log("  Set SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD to use the real gateway.");
    console.log("");
    return;
  }

  if (!env.sslcommerzSandbox) {
    console.error("");
    console.error("  ✗ Refusing to probe the LIVE gateway — this opens a real payment session.");
    console.error("    Unset SSLCOMMERZ_SANDBOX to test against the sandbox.");
    console.error("");
    process.exitCode = 1;
    return;
  }

  console.log(`  store:    ${env.SSLCOMMERZ_STORE_ID}`);
  console.log(`  gateway:  sandbox`);
  console.log(`  app url:  ${env.APP_URL}`);
  console.log("");

  if (env.APP_URL.includes("localhost")) {
    console.log("  ! APP_URL is localhost. The session below will open, but SSLCommerz");
    console.log("    cannot deliver an IPN to it — settlement will only work once deployed.");
    console.log("");
  }

  const { getPaymentProvider } = await import("../lib/payments/provider");
  const provider = getPaymentProvider();

  try {
    const intent = await provider.createPayment({
      amount: 500,
      currency: "BDT",
      reference: "PAYCHECK",
      description: "Niramoy credential check",
      method: "bkash",
      returnUrl: env.APP_URL,
      // Timestamped so each run opens its own session rather than colliding
      // with the last one's transaction id.
      idempotencyKey: `paycheck:${Date.now()}`,
    });

    console.log("  ✓ session created — credentials accepted");
    console.log(`    transaction: ${intent.providerPaymentId}`);
    console.log("");
    console.log("    Open this to see the hosted bKash page:");
    console.log(`    ${intent.redirectUrl}`);
    console.log("");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const meta = (err as { meta?: Record<string, unknown> }).meta;
    console.error("  ✗ session refused");
    console.error(`    ${message}`);
    if (meta?.reason) console.error(`    reason: ${String(meta.reason)}`);
    console.error("");
    console.error("    Check SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD against");
    console.error("    the sandbox credentials at developer.sslcommerz.com.");
    console.error("");
    process.exitCode = 1;
  }
}

void main();
