/**
 * Niramoy — Bangladeshi mobile numbers
 * -----------------------------------------------------------------------------
 * One place that decides what a phone number is, because three parts of the
 * system have to agree on it: the column it is stored in, the code sent to it,
 * and the string the gateway is handed. A number stored as "01712-345678" and
 * verified as "+8801712345678" is the same person and two different rows.
 *
 * Storage is E.164 (+8801XXXXXXXXX) — the form the SMS gateway accepts and the
 * only form that is unambiguous. Everything a person is likely to type is
 * accepted on the way in: local (01712345678), international with or without a
 * plus, spaces, dashes and the Bangla digits ০-৯ a Bangla keyboard produces.
 *
 * Only Bangladeshi mobile numbers are accepted. That is not laziness about the
 * rest of the world: the gateway is an Android handset on a Bangladeshi SIM,
 * the platform serves Bangladeshi patients, and accepting a number we cannot
 * deliver to would put an unverifiable phone on an account that believes it is
 * reachable.
 */

/** 013–019 are the operator prefixes issued by the BTRC. */
const BD_MOBILE = /^01[3-9]\d{8}$/;

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Bangla digits to ASCII, so ০১৭… is the same number as 017…. */
function toAsciiDigits(value: string): string {
  return value.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)));
}

export interface NormalisedPhone {
  /** E.164, e.g. +8801712345678. */
  e164: string;
  /** National form without the country code, e.g. 01712345678. */
  national: string;
}

/**
 * Parse anything a person might type into E.164, or return null.
 *
 * Null means "not a Bangladeshi mobile number", which is the only answer this
 * function is entitled to give — it never guesses at a country code.
 */
export function normalisePhone(input: unknown): NormalisedPhone | null {
  if (input === null || input === undefined) return null;

  const raw = toAsciiDigits(String(input)).replace(/[\s\-().]/g, "");
  if (!raw) return null;

  let digits = raw.startsWith("+") ? raw.slice(1) : raw;
  if (!/^\d+$/.test(digits)) return null;

  // +8801712345678 / 8801712345678 → 01712345678
  if (digits.startsWith("880")) digits = `0${digits.slice(3)}`;
  // 1712345678 — the leading zero dropped, which is how people say it aloud.
  else if (digits.length === 10 && digits.startsWith("1")) digits = `0${digits}`;

  if (!BD_MOBILE.test(digits)) return null;
  return { e164: `+880${digits.slice(1)}`, national: digits };
}

/**
 * How a number is shown back to the person who typed it.
 *
 * Enough digits to recognise your own number, not enough for someone reading
 * over your shoulder — or reading a log line — to learn it. The last two are
 * kept because that is what people check.
 */
export function maskPhone(input: unknown): string {
  const parsed = normalisePhone(input);
  if (!parsed) return "";
  const n = parsed.national;
  return `${n.slice(0, 5)}••••${n.slice(-2)}`;
}
