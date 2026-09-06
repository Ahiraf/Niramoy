/**
 * /api/auth/verify-phone
 *
 * POST   send a code to the account's mobile number (or to a corrected one)
 * PATCH  confirm the code
 *
 * Both require a session. The account is created and signed in first, and the
 * number is proved afterwards: an unverified phone must not cost somebody their
 * account, and a sign-up that half-completes because a handset was out of
 * signal is a patient who never gets to book. What an unverified number does
 * cost is SMS reminders, which is stated on the screen that asks for it.
 *
 * The number is never echoed back in full — the responses carry a masked form,
 * because this endpoint is reachable with only a session cookie and the full
 * number is exactly what an attacker who stole one would want.
 */
import { json, ok, withRoute } from "../../../../lib/api/respond";
import { clientIp, requireUser } from "../../../../lib/security/authz";
import { enforceRateLimit } from "../../../../lib/security/rate-limit";
import {
  confirmPhoneVerification,
  startPhoneVerification,
} from "../../../../lib/services/phone-verification";

export const dynamic = "force-dynamic";

export const POST = withRoute("POST /api/auth/verify-phone", async (request, { requestId }) => {
  const principal = await requireUser(request);
  const body = await json<{ phone?: unknown }>(request, 2048);

  // Keyed on the account, not the IP: the cost of a send lands on the number
  // being sent to, and a shared mobile network puts thousands of people behind
  // one address.
  await enforceRateLimit("phone-verify:send", principal.userId);

  const state = await startPhoneVerification(principal.userId, body, {
    ip: clientIp(request),
    requestId,
  });

  return ok({ phoneVerification: state });
});

export const PATCH = withRoute("PATCH /api/auth/verify-phone", async (request, { requestId }) => {
  const principal = await requireUser(request);
  const body = await json<{ code?: unknown }>(request, 1024);

  await enforceRateLimit("phone-verify:confirm", principal.userId);

  const result = await confirmPhoneVerification(principal.userId, body, { requestId });
  return ok({ phoneVerification: result });
});
