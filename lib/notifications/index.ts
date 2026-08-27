/**
 * Niramoy — outbound messages
 * -----------------------------------------------------------------------------
 * Templates live here so that what a patient receives is reviewable in one
 * place, which matters more than usual when some of these messages carry health
 * information into an inbox we do not control.
 *
 * Rules the templates follow:
 *   - No clinical detail in an email. "You have an appointment with Dr X on
 *     Tuesday" is the limit; the reason for the visit stays in the app.
 *   - Every message says how to stop or query it.
 *   - Plain text always; HTML is an enhancement, never the only version.
 */

import { getEnv } from "../config/env";
import { getEmailProvider } from "./providers";

export * from "./providers";

const signOff = (): string =>
  `\n—\nNiramoy · নিরাময়\nIf you did not expect this email, you can ignore it.\n`;

export async function sendEmailVerification(input: {
  to: string;
  name: string;
  token: string;
}): Promise<void> {
  const url = `${getEnv().APP_URL}/verify-email?token=${encodeURIComponent(input.token)}`;
  await getEmailProvider().send({
    to: input.to,
    subject: "Confirm your Niramoy email address",
    text:
      `Hello ${input.name},\n\n` +
      `Confirm your email address to finish setting up your Niramoy account:\n\n${url}\n\n` +
      `This link expires in 24 hours.\n` +
      signOff(),
  });
}

/**
 * The reset email.
 *
 * Sent only when the address actually has an active account. The endpoint
 * returns the same response either way, so the absence of an email is the only
 * difference — visible to the mailbox owner, which is the point, and to nobody
 * else.
 */
export async function sendPasswordReset(input: {
  to: string;
  name: string;
  token: string;
}): Promise<void> {
  const url = `${getEnv().APP_URL}/reset-password?token=${encodeURIComponent(input.token)}`;
  await getEmailProvider().send({
    to: input.to,
    subject: "Reset your Niramoy password",
    text:
      `Hello ${input.name},\n\n` +
      `Someone asked to reset the password on your Niramoy account. If it was you, ` +
      `use this link:\n\n${url}\n\n` +
      `It expires in 30 minutes and can be used once.\n\n` +
      `If it wasn't you, no action is needed — your password has not changed.\n` +
      signOff(),
  });
}

export async function sendAppointmentReminder(input: {
  to: string;
  name: string;
  doctorName: string;
  whenLabel: string;
}): Promise<void> {
  await getEmailProvider().send({
    to: input.to,
    subject: `Reminder: your consultation is ${input.whenLabel}`,
    text:
      `Hello ${input.name},\n\n` +
      `This is a reminder that your consultation with ${input.doctorName} is ${input.whenLabel}.\n\n` +
      `Open Niramoy a few minutes early to join: ${getEnv().APP_URL}\n` +
      signOff(),
  });
}

export async function sendWaitlistOffer(input: {
  to: string;
  name: string;
  doctorName: string;
  whenLabel: string;
  holdMinutes: number;
}): Promise<void> {
  await getEmailProvider().send({
    to: input.to,
    subject: `A slot opened up with ${input.doctorName}`,
    text:
      `Hello ${input.name},\n\n` +
      `${input.doctorName} has an opening ${input.whenLabel}, and it is held for you ` +
      `for the next ${input.holdMinutes} minutes.\n\n` +
      `Claim it here: ${getEnv().APP_URL}\n\n` +
      `After that it goes to the next person waiting.\n` +
      signOff(),
  });
}
