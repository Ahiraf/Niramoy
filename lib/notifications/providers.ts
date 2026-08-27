/**
 * Niramoy — notification providers
 * -----------------------------------------------------------------------------
 * An interface with two implementations, so the application works with no email
 * credentials configured and gains real delivery by setting one variable.
 *
 * SMS is not implemented. The interface is shaped so it can be added without
 * touching a caller, but shipping a stub that silently drops messages would be
 * worse than not having it: an appointment reminder that appears to send and
 * does not is a missed consultation.
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

let cached: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  const env = getEnv();
  cached =
    env.emailProvider === "resend" && env.EMAIL_API_KEY
      ? resendProvider(env.EMAIL_API_KEY, env.EMAIL_FROM ?? "Niramoy <noreply@niramoy.app>")
      : consoleProvider;
  return cached;
}

export function resetEmailProvider(): void {
  cached = undefined;
}
