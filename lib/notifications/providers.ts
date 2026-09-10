/**
 * Niramoy — notification providers
 * -----------------------------------------------------------------------------
 * An interface with two implementations, so the application works with no email
 * credentials configured and gains real delivery by setting one variable.
 *
 * SMS lives next door in ./sms.ts and follows the same shape. It differs in one
 * respect worth knowing before copying this file: its console implementation
 * reports `delivered: false`, because a verification code that appears to send
 * and does not is an account nobody can finish creating.
 */

import { getEnv } from "../config/env";
import { logger } from "../observability/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text. Every message must be readable without HTML. */
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ delivered: boolean; id?: string }>;
}

/**
 * The default. Writes the message to the log instead of sending it.
 *
 * Recipient and subject are logged; the body is not, because a password-reset
 * body contains a working reset link and an appointment reminder contains a
 * doctor's name and a time. In development the body goes to stdout so the link
 * is usable, and that is gated on not being production.
 */
const consoleProvider: EmailProvider = {
  name: "console",
  async send(message) {
    const env = getEnv();
    logger.info("email (console provider)", { to: message.to, subject: message.subject });
    if (!env.isProd && !env.isTest) {
      process.stdout.write(
        `\n--- email to ${message.to} ---\n${message.subject}\n\n${message.text}\n---\n\n`,
      );
    }
    return { delivered: true };
  },
};

function resendProvider(apiKey: string, from: string): EmailProvider {
  return {
    name: "resend",
    async send(message) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
      });
      if (!res.ok) {
        throw new Error(`resend responded ${res.status}`);
      }
      const body = (await res.json()) as { id?: string };
      return { delivered: true, ...(body.id ? { id: body.id } : {}) };
    },
  };
}

/**
 * SMTP, via nodemailer.
 *
 * The reason this exists alongside Resend: Resend needs a domain you can add
 * DNS records to before it will send anywhere except your own address, and a
 * student project usually does not have one. SMTP works with an ordinary
 * mailbox — a Gmail account with an App Password — so email verification and
 * password reset can actually reach a marker's inbox.
 *
 * The transport is built once and reused. Nodemailer pools the connection, and
 * rebuilding it per message would mean a fresh TLS handshake and SMTP AUTH for
 * every reminder.
 *
 * A `from` that does not match the authenticated mailbox is silently rewritten
 * by most providers (Gmail always does), so `EMAIL_FROM` defaults to the SMTP
 * user rather than to a niramoy.app address that would quietly become something
 * else. Anyone who deliberately sets a different envelope has presumably
 * configured the alias to go with it.
 */
function smtpProvider(config: {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
  from: string;
}): EmailProvider {
  // Imported lazily so nodemailer is never pulled into a bundle that does not
  // send mail — it is a server-only package with a large dependency tree.
  let transport: import("nodemailer").Transporter | undefined;

  async function getTransport(): Promise<import("nodemailer").Transporter> {
    if (transport) return transport;
    const nodemailer = await import("nodemailer");
    transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      // Implicit TLS on 465; STARTTLS on 587, which nodemailer negotiates.
      secure: config.secure,
      auth: { user: config.user, pass: config.password },
      // Serverless functions are short-lived; a connection that outlives the
      // invocation is not reused, only held open against a quota.
      pool: false,
      /*
       * These must fit INSIDE the serverless function's budget, which on
       * Vercel's Hobby plan starts at 10 seconds.
       *
       * The call sites already wrap delivery in `.catch` so a bounce cannot
       * fail a sign-up — but a catch only helps a promise that REJECTS. An SMTP
       * connection that hangs rejects nothing: it holds the request open until
       * the platform kills the whole function, and the caller gets a generic
       * 500 for a registration that actually succeeded. Worst case here is now
       * ~8s rather than ~20s, so the mailer gives up before the platform does.
       */
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 8_000,
    });
    return transport;
  }

  return {
    name: "smtp",
    async send(message) {
      const mailer = await getTransport();
      const info = await mailer.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });

      /*
       * A recipient the server REFUSED is not a delivery, even though sendMail
       * resolved. Nodemailer reports partial acceptance rather than throwing,
       * and treating that as sent is how a verification link silently goes
       * nowhere — the same failure the SMS console provider exists to avoid.
       */
      if (info.rejected?.length) {
        throw new Error(`smtp rejected ${info.rejected.join(", ")}`);
      }
      return { delivered: true, ...(info.messageId ? { id: info.messageId } : {}) };
    },
  };
}

let cached: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  const env = getEnv();

  if (env.emailProvider === "smtp" && env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD) {
    const port = env.SMTP_PORT ?? 587;
    cached = smtpProvider({
      host: env.SMTP_HOST,
      port,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      // 465 is implicit TLS. Anything else starts plaintext and upgrades.
      secure: env.SMTP_SECURE === undefined ? port === 465 : env.SMTP_SECURE === "true",
      from: env.EMAIL_FROM ?? env.SMTP_USER,
    });
    return cached;
  }

  cached =
    env.emailProvider === "resend" && env.EMAIL_API_KEY
      ? resendProvider(env.EMAIL_API_KEY, env.EMAIL_FROM ?? "Niramoy <noreply@niramoy.app>")
      : consoleProvider;
  return cached;
}

export function resetEmailProvider(): void {
  cached = undefined;
}
