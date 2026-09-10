/**
 * npm run email:check [recipient] — verify the configured mailer.
 *
 * The failure this exists to catch: with no working credential the app falls
 * back to the console provider, which logs the message and reports it
 * delivered. Sign-up then looks completely normal and the verification link
 * goes to a log file. Nothing errors, and nothing arrives.
 *
 * With a recipient it sends a real message. Without one it only opens the
 * connection and authenticates, which is enough to catch a wrong password.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env", override: false });

async function main(): Promise<void> {
  const { getEnv } = await import("../lib/config/env");
  const env = getEnv();
  const recipient = process.argv[2];

  console.log("");
  console.log(`▸ email provider: ${env.emailProvider}`);

  if (env.emailProvider === "console") {
    console.log("");
    console.log("  Messages are written to the log, NOT sent.");
    console.log("  Verification and password-reset links will never reach an inbox.");
    console.log("  Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD to send for real.");
    console.log("");
    return;
  }

  if (env.emailProvider === "smtp") {
    const port = env.SMTP_PORT ?? 587;
    console.log(`  host:   ${env.SMTP_HOST}:${port}`);
    console.log(`  user:   ${env.SMTP_USER}`);
    console.log(`  from:   ${env.EMAIL_FROM ?? env.SMTP_USER}`);
    console.log("");

    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      secure: env.SMTP_SECURE === undefined ? port === 465 : env.SMTP_SECURE === "true",
      auth: { user: env.SMTP_USER!, pass: env.SMTP_PASSWORD! },
      connectionTimeout: 15_000,
    });

    try {
      await transport.verify();
      console.log("  ✓ connected and authenticated");
    } catch (err) {
      console.error("  ✗ could not authenticate");
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      console.error("");
      console.error("    For Gmail this must be an App Password (16 characters, no spaces),");
      console.error("    not the account password, and 2-step verification must be on.");
      console.error("");
      process.exitCode = 1;
      return;
    }
  }

  if (!recipient) {
    console.log("");
    console.log("  Pass an address to send a real test message:");
    console.log("    npm run email:check -- you@example.com");
    console.log("");
    return;
  }

  const { getEmailProvider } = await import("../lib/notifications/providers");
  try {
    const result = await getEmailProvider().send({
      to: recipient,
      subject: "Niramoy — email check",
      text:
        "This is a test message from Niramoy.\n\n" +
        "If you are reading it, verification and password-reset email will reach patients.\n",
    });
    console.log(`  ✓ sent to ${recipient}${result.id ? ` (${result.id})` : ""}`);
    console.log("    Check spam if it does not appear — a new sender often lands there first.");
    console.log("");
  } catch (err) {
    console.error(`  ✗ send failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error("");
    process.exitCode = 1;
  }
}

void main();
