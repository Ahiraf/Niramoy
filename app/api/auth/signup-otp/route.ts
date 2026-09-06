/**
 * /api/auth/signup-otp — the code at the front of sign-up.
 *
 * POST   send a six-digit code to a mobile number
 * PATCH  confirm it, and receive the ticket registration will spend
 *
 * No session, because the whole point is that there is no account yet. That
 * makes this the one endpoint where an anonymous caller can cause a real SMS to
 * reach a stranger's handset, so it carries the tightest limits in the
 * application: per number as well as per address, since either alone is trivial
 * to walk around.
 *
 * The response never says whether the number already has an account. That
 * question belongs behind a password, and answering it here would turn sign-up
 * into a way to test whether somebody you know is a patient of ours.
 */
import { json, ok, withRoute } from "../../../../lib/api/respond";
import { normalisePhone } from "../../../../lib/auth/phone";
import { AppError } from "../../../../lib/errors";
import { clientIp } from "../../../../lib/security/authz";
import { enforceRateLimit } from "../../../../lib/security/rate-limit";
import {
  confirmSignupVerification,
  startSignupVerification,
} from "../../../../lib/services/phone-verification";

export const dynamic = "force-dynamic";

/** Shared by both handlers so a malformed number never reaches a limiter key. */
function requirePhone(value: unknown): string {
  const parsed = normalisePhone(value);
  if (!parsed) {
    throw new AppError("VALIDATION_FAILED", {
      details: {
        phone: [
          "Enter a Bangladeshi mobile number, like 01712 345678.",
          "বাংলাদেশি মোবাইল নম্বর দিন, যেমন ০১৭১২ ৩৪৫৬৭৮।",
        ],
      },
    });
  }
  return parsed.e164;
}

export const POST = withRoute("POST /api/auth/signup-otp", async (request, { requestId }) => {
  const body = await json<{ phone?: unknown }>(request, 1024);
  const ip = clientIp(request);
  const phone = requirePhone(body.phone);

  await enforceRateLimit("signup-otp:phone", phone);
  await enforceRateLimit("signup-otp:ip", ip ?? "unknown");

  const state = await startSignupVerification({ phone }, { ip, requestId });
  return ok({ phoneVerification: state });
});

export const PATCH = withRoute("PATCH /api/auth/signup-otp", async (request, { requestId }) => {
  const body = await json<{ phone?: unknown; code?: unknown }>(request, 1024);
  const ip = clientIp(request);
  const phone = requirePhone(body.phone);

  await enforceRateLimit("signup-otp:confirm", ip ?? "unknown");

  const result = await confirmSignupVerification({ phone, code: body.code }, { ip, requestId });
  return ok({ phoneVerification: result });
});
