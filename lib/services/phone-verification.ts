/**
 * Niramoy — mobile number verification
 * -----------------------------------------------------------------------------
 * Proving, at sign-up, that the number on an account is a number the person
 * signing up is holding.
 *
 * Why it matters here more than on a typical product: the phone is how a
 * patient in Bangladesh is actually reached. Email is a formality many patients
 * never open; the SMS is what tells them their consultation is in an hour. A
 * mistyped digit produces an account that looks reachable, passes every check,
 * and silently sends every reminder to a stranger.
 *
 * The design, and the reason for each part:
 *
 *   SIX DIGITS, TEN MINUTES. Short enough to read off a lock screen and type
 *   into another device, which is the whole flow. Short also means guessable,
 *   so it is paired with the two limits below.
 *
 *   FIVE GUESSES PER CODE, counted on the token row and burnt at the cap. One
 *   in 200,000 per code, and the code dies rather than the account — locking
 *   the account would let anybody who knows your number lock you out of it.
 *
 *   THREE SENDS PER HOUR. Each send is a real SMS through a real handset. An
 *   unbounded resend button is a way to bill somebody else's gateway and, in a
 *   country where the recipient sees every message, to harass a stranger whose
 *   number was typed in on purpose.
 *
 *   ONE LIVE CODE. Sending a new one kills the old one, so a code read from an
 *   older message cannot be used after the person asked for another.
 *
 *   THE CODE IS NEVER STORED. Only a digest keyed with the session secret and
 *   the user id — keyed because a bare SHA-256 of six digits is a lookup table
 *   with a million rows, and by user id because two accounts holding the same
 *   code must not collide on the unique index over token hashes.
 */

import { randomInt } from "node:crypto";

import { audit } from "../audit";
import { getEnv } from "../config/env";
import { generateToken, hashClientAttribute, hashToken, tokensMatch } from "../auth/tokens";
import { maskPhone, normalisePhone } from "../auth/phone";
import { AppError } from "../errors";
import { logger } from "../observability/logger";
import { sendPhoneVerificationCode } from "../notifications";
import { getSmsProvider } from "../notifications/sms";
import * as phoneVerifications from "../repositories/phone-verifications";
import * as users from "../repositories/users";

export const PHONE_CODE_TTL_MINUTES = 10;
export const PHONE_CODE_MAX_ATTEMPTS = 5;

/**
 * The code at the front of sign-up gets a shorter life than the one sent to an
 * account that already exists: the person is sitting on the form with the phone
 * in their hand, and a code that outlives that moment is only a wider window
 * for somebody else.
 */
export const SIGNUP_OTP_TTL_MINUTES = 5;
/** How long the verified number stays claimable while the form is filled in. */
export const SIGNUP_TICKET_TTL_MINUTES = 30;

/** A uniformly random six-digit code, leading zeros included. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * The stored digest. Keyed with the session secret so a database leak does not
 * hand over live codes, and with the user id so the same six digits issued to
 * two people produce two different rows.
 */
function codeHash(userId: string, code: string): string {
  return hashToken(`${getEnv().sessionSecret ?? ""}:phone_verification:${userId}:${code}`);
}

export interface PhoneVerificationState {
  /** Masked — enough to recognise your own number, not enough to learn it. */
  phone: string;
  verified: boolean;
  /** False when no gateway is configured: the code was printed, not sent. */
  delivered: boolean;
  expiresInMinutes: number;
  attemptsAllowed: number;
}

const invalidPhone = () =>
  new AppError("VALIDATION_FAILED", {
    details: {
      phone: [
        "Enter a Bangladeshi mobile number, like 01712 345678.",
        "বাংলাদেশি মোবাইল নম্বর দিন, যেমন ০১৭১২ ৩৪৫৬৭৮।",
      ],
    },
  });

/* -------------------------------------------------------------------------- */
/* Before the account exists                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Sign-up starts here: a number, a code, and nothing else until the code comes
 * back.
 *
 * This endpoint is reachable without a session, which makes it the one place in
 * the application where an anonymous caller can cause a real SMS to be sent to
 * a stranger's phone. Everything about it is shaped by that:
 *
 *   - the caller is limited per IP and the NUMBER is limited per hour, so
 *     neither a script nor a rotating proxy can use us to text somebody
 *     repeatedly;
 *   - the response is identical whether or not the number already has an
 *     account, because "is this number registered?" is not a question an
 *     anonymous caller may ask;
 *   - nothing is written against a user, because there is no user.
 */
export async function startSignupVerification(
  input: { phone?: unknown },
  context: { ip?: string | null; requestId?: string },
): Promise<{ phone: string; expiresInSeconds: number; delivered: boolean; attemptsAllowed: number }> {
  const target = normalisePhone(input.phone);
  if (!target) throw invalidPhone();

  const code = generateCode();
  const expiresAt = new Date(Date.now() + SIGNUP_OTP_TTL_MINUTES * 60_000);

  await phoneVerifications.create({
    phone: target.e164,
    codeHash: signupCodeHash(target.e164, code),
    expiresAt,
    ipHash: hashClientAttribute(context.ip, getEnv().sessionSecret ?? ""),
  });

  let delivered = false;
  try {
    const result = await sendPhoneVerificationCode({
      to: target.e164,
      code,
      expiresInMinutes: SIGNUP_OTP_TTL_MINUTES,
    });
    delivered = result.delivered;
  } catch (err) {
    logger.error("signup sms failed", { err, provider: getSmsProvider().name });
    throw new AppError("PROVIDER_UNAVAILABLE", {
      message: "We couldn't send the code just now. Please try again in a moment.",
    });
  }

  await audit({
    action: "auth.phone_verification_send",
    actorIpHash: hashClientAttribute(context.ip, getEnv().sessionSecret ?? ""),
    requestId: context.requestId,
    metadata: { phone: maskPhone(target.e164), stage: "signup", delivered },
  });

  return {
    phone: maskPhone(target.e164),
    expiresInSeconds: SIGNUP_OTP_TTL_MINUTES * 60,
    delivered,
    attemptsAllowed: PHONE_CODE_MAX_ATTEMPTS,
  };
}

/**
 * Check the code and hand back the ticket registration will spend.
 *
 * The ticket is what makes the verification belong to this browser. Without it
 * "this number was proved a minute ago" would be a fact anybody could ride, and
 * a second visitor could register against a number somebody else had just
 * proved.
 */
export async function confirmSignupVerification(
  input: { phone?: unknown; code?: unknown },
  context: { requestId?: string; ip?: string | null },
): Promise<{ phone: string; ticket: string; ticketExpiresInMinutes: number }> {
  const target = normalisePhone(input.phone);
  if (!target) throw invalidPhone();

  const code = String(input.code ?? "").replace(/\D/g, "");
  const pending = await phoneVerifications.findPendingCode(target.e164);

  // Same answer for "no code was ever sent" and "the code expired": which of
  // those it is would be information about somebody else's sign-up.
  if (!pending) {
    throw new AppError("NOT_ELIGIBLE", { message: "That code has expired. Ask for a new one." });
  }

  if (code.length !== 6 || !tokensMatch(signupCodeHash(target.e164, code), pending.codeHash)) {
    const attempts = await phoneVerifications.recordAttempt(pending.id, PHONE_CODE_MAX_ATTEMPTS);
    const remaining = Math.max(0, PHONE_CODE_MAX_ATTEMPTS - attempts);

    await audit({
      action: "auth.phone_verification_failed",
      actorIpHash: hashClientAttribute(context.ip, getEnv().sessionSecret ?? ""),
      requestId: context.requestId,
      outcome: "denied",
      metadata: { attempts, stage: "signup" },
    });

    throw new AppError("VALIDATION_FAILED", {
      details: {
        code: [
          remaining > 0
            ? `That code isn't right. ${remaining} ${remaining === 1 ? "try" : "tries"} left.`
            : "Too many wrong codes. Ask for a new one.",
        ],
      },
    });
  }

  const ticket = generateToken();
  if (!(await phoneVerifications.markVerified(pending.id, hashToken(ticket)))) {
    // Another request verified it first; its ticket is the live one.
    throw new AppError("NOT_ELIGIBLE", { message: "That code has already been used." });
  }

  await audit({
    action: "auth.phone_verify",
    actorIpHash: hashClientAttribute(context.ip, getEnv().sessionSecret ?? ""),
    requestId: context.requestId,
    metadata: { phone: maskPhone(target.e164), stage: "signup" },
  });

  return {
    phone: maskPhone(target.e164),
    ticket,
    ticketExpiresInMinutes: SIGNUP_TICKET_TTL_MINUTES,
  };
}

/**
 * Spend a ticket at registration. Returns false when it is missing, wrong,
 * already spent, issued for a different number, or too old.
 */
export async function claimSignupVerification(
  phoneE164: string,
  ticket: unknown,
): Promise<boolean> {
  const value = String(ticket ?? "");
  if (!value) return false;
  return phoneVerifications.consumeTicket(
    phoneE164,
    hashToken(value),
    SIGNUP_TICKET_TTL_MINUTES,
  );
}

/**
 * The digest of a pre-account code.
 *
 * Keyed with the session secret so a database leak does not hand over live
 * codes, and with the phone number — which is the only identity this stage
 * has — so the same six digits issued to two numbers are two different rows.
 */
function signupCodeHash(phoneE164: string, code: string): string {
  return hashToken(`${getEnv().sessionSecret ?? ""}:signup_phone:${phoneE164}:${code}`);
}

/* -------------------------------------------------------------------------- */
/* Sending                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Issue a code to the account's number, or to a corrected one.
 *
 * Accepting a replacement number here is what makes the sign-up recoverable: a
 * person who mistyped a digit finds out on this screen, and fixing it must not
 * mean deleting the account and starting again. Changing the number clears any
 * previous verification — that happens inside the update statement itself.
 */
export async function startPhoneVerification(
  userId: string,
  input: { phone?: unknown },
  context: { ip?: string | null; requestId?: string },
): Promise<PhoneVerificationState> {
  const user = await users.findById(userId);
  if (!user) throw new AppError("UNAUTHENTICATED");

  // A number supplied now replaces the one on the account; otherwise verify
  // whatever sign-up recorded.
  const supplied = input.phone === undefined || String(input.phone ?? "").trim() === ""
    ? null
    : normalisePhone(input.phone);
  if (input.phone !== undefined && String(input.phone ?? "").trim() !== "" && !supplied) {
    throw invalidPhone();
  }

  const target = supplied ?? (user.phone ? normalisePhone(user.phone) : null);
  if (!target) throw invalidPhone();

  let current = user;
  if (user.phone !== target.e164) {
    // Also normalises a number that was stored in some other shape, so what we
    // verify and what the gateway is handed are the same string.
    const updated = await users.updateProfile(userId, { phone: target.e164 });
    if (!updated) throw new AppError("NOT_FOUND");
    current = updated;
  }

  if (current.phoneVerifiedAt) {
    return {
      phone: maskPhone(target.e164),
      verified: true,
      delivered: false,
      expiresInMinutes: PHONE_CODE_TTL_MINUTES,
      attemptsAllowed: PHONE_CODE_MAX_ATTEMPTS,
    };
  }

  // One live code at a time: a code read from an older message is dead as soon
  // as a newer one is asked for.
  await users.revokeAuthTokens(userId, "phone_verification");

  const code = generateCode();
  await users.createAuthToken({
    userId,
    purpose: "phone_verification",
    tokenHash: codeHash(userId, code),
    expiresAt: new Date(Date.now() + PHONE_CODE_TTL_MINUTES * 60_000),
    ipHash: hashClientAttribute(context.ip, getEnv().sessionSecret ?? ""),
  });

  let delivered = false;
  try {
    const result = await sendPhoneVerificationCode({
      to: target.e164,
      code,
      expiresInMinutes: PHONE_CODE_TTL_MINUTES,
    });
    delivered = result.delivered;
  } catch (err) {
    // The gateway is a handset: it goes flat, loses signal, and comes back.
    // Kill the code nobody received rather than leaving a live one behind, and
    // say plainly that the message did not go out.
    await users.revokeAuthTokens(userId, "phone_verification");
    logger.error("verification sms failed", { err, userId, provider: getSmsProvider().name });
    throw new AppError("PROVIDER_UNAVAILABLE", {
      message: "We couldn't send the code just now. Please try again in a moment.",
    });
  }

  await audit({
    action: "auth.phone_verification_send",
    actorUserId: userId,
    actorRole: current.role,
    requestId: context.requestId,
    resourceType: "user",
    resourceId: userId,
    metadata: { phone: maskPhone(target.e164), provider: getSmsProvider().name, delivered },
  });

  return {
    phone: maskPhone(target.e164),
    verified: false,
    delivered,
    expiresInMinutes: PHONE_CODE_TTL_MINUTES,
    attemptsAllowed: PHONE_CODE_MAX_ATTEMPTS,
  };
}

/* -------------------------------------------------------------------------- */
/* Confirming                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Check a code and, if it is right, record the number as proved.
 *
 * Every failure path says the same thing to the caller — the code is wrong or
 * expired — with how many guesses are left, which is information the person
 * holding the phone needs and an attacker learns nothing from.
 */
export async function confirmPhoneVerification(
  userId: string,
  input: { code?: unknown },
  context: { requestId?: string },
): Promise<{ phone: string; verified: true }> {
  const code = String(input.code ?? "").replace(/\D/g, "");

  const user = await users.findById(userId);
  if (!user) throw new AppError("UNAUTHENTICATED");
  if (user.phoneVerifiedAt) return { phone: maskPhone(user.phone), verified: true };

  const token = await users.findLiveAuthToken(userId, "phone_verification");
  if (!token) {
    throw new AppError("NOT_ELIGIBLE", {
      message: "That code has expired. Ask for a new one.",
    });
  }

  if (code.length !== 6 || !tokensMatch(codeHash(userId, code), token.tokenHash)) {
    const attempts = await users.recordTokenAttempt(token.id, PHONE_CODE_MAX_ATTEMPTS);
    const remaining = Math.max(0, PHONE_CODE_MAX_ATTEMPTS - attempts);

    await audit({
      action: "auth.phone_verification_failed",
      actorUserId: userId,
      actorRole: user.role,
      requestId: context.requestId,
      outcome: "denied",
      metadata: { attempts },
    });

    throw new AppError("VALIDATION_FAILED", {
      details: {
        code: [
          remaining > 0
            ? `That code isn't right. ${remaining} ${remaining === 1 ? "try" : "tries"} left.`
            : "Too many wrong codes. Ask for a new one.",
        ],
      },
    });
  }

  // Spend the code before recording anything, so a replayed request cannot
  // verify a number that was edited in between.
  if (!(await users.consumeAuthTokenById(token.id))) {
    throw new AppError("NOT_ELIGIBLE", { message: "That code has already been used." });
  }

  if (!user.phone || !(await users.markPhoneVerified(userId, user.phone))) {
    throw new AppError("NOT_ELIGIBLE", {
      message: "That number changed while we were checking. Ask for a new code.",
    });
  }

  await audit({
    action: "auth.phone_verify",
    actorUserId: userId,
    actorRole: user.role,
    requestId: context.requestId,
    resourceType: "user",
    resourceId: userId,
    metadata: { phone: maskPhone(user.phone) },
  });

  return { phone: maskPhone(user.phone), verified: true };
}
