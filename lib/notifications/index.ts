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
import { getSmsProvider, type SmsResult } from "./sms";

export * from "./providers";
export * from "./sms";

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
 * The sign-up verification code.
 *
 * Every word here is chosen against the constraints of one SMS segment, so the
 * reasoning is worth writing down.
 *
 *   ONE SEGMENT. Any Bangla character forces the whole message to UCS-2, which
 *   is 70 characters per segment instead of GSM-7's 160. This message is 59,
 *   with room to edit. The earlier bilingual version was 97 — two segments,
 *   which on a handset gateway means two billed messages and two chances to
 *   deliver half a code. `SMS_SEGMENT_LIMIT` below is asserted in the tests.
 *
 *   BANGLA FOR THE WARNING. "Do not share this code" is the only sentence here
 *   that does any work, and it is the sentence that stops an OTP scam. A
 *   warning the reader cannot read protects nobody, and the app now opens in
 *   Bangla, so this is the language they were reading a moment ago.
 *
 *   LATIN FOR THE NAME AND ASCII FOR EVERY DIGIT. A phone that cannot render
 *   Bangla shows boxes — still common on older handsets, and the number on an
 *   account is not always a smartphone. Keeping the sender name, the code and
 *   the expiry outside Bangla means that on such a device the message still
 *   reads "Niramoy … 821842 (10 min)", which is everything needed to act. The
 *   code in Bangla numerals (১২৩৪৫৬) would also have to be transcribed back
 *   into an ASCII field, which is its own way to lock somebody out.
 *
 * No link, deliberately: a URL in an OTP message is the phishing pattern the
 * warning is about, and the fastest route into an operator's spam filter.
 */
export const SMS_SEGMENT_LIMIT = 70;

export async function sendPhoneVerificationCode(input: {
  to: string;
  code: string;
  expiresInMinutes: number;
}): Promise<SmsResult> {
  return getSmsProvider().send({
    to: input.to,
    text:
      `Niramoy যাচাই কোড: ${input.code} (${input.expiresInMinutes} min)। ` +
      `কোডটি কাউকে জানাবেন না।`,
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

/**
 * A copy of an in-app notification, sent to an address.
 *
 * Deliberately thin: the title and a one-line body, and then a pointer back
 * into the app. Everything clinical stays behind the login — an inbox is not a
 * medical record and we do not control who else reads it.
 */
export async function sendNotificationCopy(input: {
  to: string;
  name: string;
  title: string;
  body: string;
}): Promise<{ delivered: boolean }> {
  const url = getEnv().APP_URL;
  const result = await getEmailProvider().send({
    to: input.to,
    subject: `Niramoy — ${input.title}`,
    text:
      `Hello ${input.name},\n\n` +
      `${input.body}\n\n` +
      `Open Niramoy to see the details: ${url}\n\n` +
      `You are receiving this because email is switched on in your Niramoy\n` +
      `notification settings. You can turn it off there at any time.\n` +
      signOff(),
  });
  return { delivered: result.delivered };
}

/**
 * The same in-app notification, as a text message.
 *
 * Thinner than the email and for the same reason, plus one of its own: an SMS
 * sits unencrypted on a lock screen anyone standing nearby can read. Title and
 * one line, no link — a URL in an SMS is both a phishing pattern and the fastest
 * way onto an operator's spam filter — and a hard cap, because a long Bangla
 * message becomes several segments and a handset relay may deliver only some.
 */
export async function sendNotificationSms(input: {
  to: string;
  title: string;
  body: string;
}): Promise<{ delivered: boolean }> {
  const line = `Niramoy — ${input.title}. ${input.body}`;
  const result = await getSmsProvider().send({
    to: input.to,
    text: line.length > 300 ? `${line.slice(0, 297)}…` : line,
  });
  return { delivered: result.delivered };
}
