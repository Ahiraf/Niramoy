/**
 * POST /api/auth/register
 *
 * Doctors additionally send their BM&DC number so it can be shape-checked at
 * sign-up. The account is created immediately but is not bookable: it stays
 * unverified until the doctor files an application and an admin confirms the
 * number against the register. A well-formed number is not a verified number,
 * and nothing here treats it as one.
 */
import { created, json, withRoute } from "../../../../lib/api/respond";
import { csrfCookie, sessionCookie, withCookies } from "../../../../lib/auth/cookies";
import { AppError } from "../../../../lib/errors";
import { clientIp } from "../../../../lib/security/authz";
import { consumeRateLimit, enforceRateLimitPeek } from "../../../../lib/security/rate-limit";
import { register } from "../../../../lib/services/auth";
import { sendEmailVerification } from "../../../../lib/notifications";
import { startPhoneVerification } from "../../../../lib/services/phone-verification";
import { validateRegistrationNumber } from "../../../../lib/bmdc.js";

export const dynamic = "force-dynamic";

export const POST = withRoute("POST /api/auth/register", async (request, { requestId, logger }) => {
  const body = await json<Record<string, unknown>>(request, 8192);
  const ip = clientIp(request);

  /**
   * The bucket is charged for accounts made, not for forms submitted.
   *
   * Checked here so somebody already over the limit is turned away before any
   * work happens, but spent only once an account actually exists (below). A
   * mistyped password creates nothing and costs nothing, and it should not
   * burn an attempt — five typos used to lock a household out of signing up
   * for the rest of the hour. What the limit is for is bulk account creation,
   * and that still counts. Probing which emails are taken is not a way around
   * it either: every patient and doctor sign-up has to spend a phone
   * verification ticket before the address is ever looked at, and those are
   * limited far more tightly than this.
   */
  await enforceRateLimitPeek("register:ip", ip ?? "unknown");

  // Reject a malformed registration number before creating anything. A doctor
  // must give one: it is half of what the admin approved, and without it there
  // is nothing to match their approval against.
  let bmdc: { normalised: string; type: string } | null = null;
  if (body.role === "doctor") {
    if (!body.bmdcNumber) {
      throw new AppError("VALIDATION_FAILED", {
        details: { bmdcNumber: ["Enter the BM&DC number an admin approved for you."] },
      });
    }
    const shape = validateRegistrationNumber(body.bmdcNumber, body.registrationType) as {
      ok: boolean;
      normalised?: string;
      type?: string;
      reason?: string;
    };
    if (!shape.ok) {
      throw new AppError("BMDC_INVALID", { meta: { reason: shape.reason } });
    }
    bmdc = { normalised: shape.normalised!, type: shape.type! };
  }

  const { user, session, verificationToken } = await register(body, {
    ip,
    userAgent: request.headers.get("user-agent"),
    requestId,
  });

  await consumeRateLimit("register:ip", ip ?? "unknown");

  // Delivery failure must not fail the sign-up — the user can request another.
  await sendEmailVerification({ to: user.email, name: user.name, token: verificationToken }).catch(
    (err: unknown) => logger.error("verification email failed", { err, userId: user.id }),
  );

  /**
   * A code, only for an account that arrived here without a proved number.
   *
   * Patients and doctors cannot: they passed /api/auth/signup-otp before this
   * form appeared, and their number is already verified. What is left is the
   * staff path, where an admin may have given a number without one. A gateway
   * outage must not fail the registration — the account exists and the session
   * is issued — but it must not claim a code is coming either, hence
   * `phoneVerification: null` rather than an optimistic shape.
   */
  let phoneVerification = null;
  if (user.phone && !user.phoneVerified) {
    phoneVerification = await startPhoneVerification(user.id, {}, { ip, requestId }).catch(
      (err: unknown) => {
        logger.error("verification sms failed at sign-up", { err, userId: user.id });
        return null;
      },
    );
  }

  return withCookies(
    created({
      user,
      csrfToken: session.csrfToken,
      phoneVerification,
      // Carries the sign-up details through to the BM&DC application form.
      draft: bmdc
        ? {
            bmdcNumber: bmdc.normalised,
            registrationType: bmdc.type,
            specialty: body.specialty ?? "",
          }
        : null,
    }),
    [sessionCookie(session.token, session.maxAge), csrfCookie(session.csrfToken, session.maxAge)],
  );
});
