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
import { enforceRateLimit } from "../../../../lib/security/rate-limit";
import { register } from "../../../../lib/services/auth";
import { sendEmailVerification } from "../../../../lib/notifications";
import { validateRegistrationNumber } from "../../../../lib/bmdc.js";

export const dynamic = "force-dynamic";

export const POST = withRoute("POST /api/auth/register", async (request, { requestId, logger }) => {
  const body = await json<Record<string, unknown>>(request, 8192);
  const ip = clientIp(request);

  await enforceRateLimit("register:ip", ip ?? "unknown");

  // Reject a malformed registration number before creating anything.
  let bmdc: { normalised: string; type: string } | null = null;
  if (body.role === "doctor" && body.bmdcNumber) {
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

  // Delivery failure must not fail the sign-up — the user can request another.
  await sendEmailVerification({ to: user.email, name: user.name, token: verificationToken }).catch(
    (err: unknown) => logger.error("verification email failed", { err, userId: user.id }),
  );

  return withCookies(
    created({
      user,
      csrfToken: session.csrfToken,
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
