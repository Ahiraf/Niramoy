/**
 * /api/auth/password-reset
 *
 * POST   request a reset link
 * PATCH  complete a reset with the token from that link
 *
 * The POST response is IDENTICAL whether or not the address has an account —
 * same status, same body, and the same work is done either way. This is the
 * single most common place a login system leaks its user list, and the leak is
 * usually not in the body but in the timing or the status code.
 */
import { json, ok, withRoute } from "../../../../lib/api/respond";
import { csrfCookie, sessionCookie, withCookies } from "../../../../lib/auth/cookies";
import { clientIp } from "../../../../lib/security/authz";
import { enforceRateLimit } from "../../../../lib/security/rate-limit";
import { completePasswordReset, requestPasswordReset } from "../../../../lib/services/auth";
import { sendPasswordReset } from "../../../../lib/notifications";

export const dynamic = "force-dynamic";

const SAME_ANSWER = {
  message:
    "If that email address has a Niramoy account, we've sent a reset link. " +
    "Check your inbox, including spam.",
};

export const POST = withRoute("POST /api/auth/password-reset", async (request, { requestId, logger }) => {
  const body = await json<{ email?: unknown }>(request, 2048);
  const ip = clientIp(request);

  // Limited on both, so this cannot be used to spray reset mail at an address
  // or to probe many addresses from one host.
  await enforceRateLimit("password-reset:ip", ip ?? "unknown");
  if (body.email) {
    await enforceRateLimit("password-reset:email", String(body.email).toLowerCase());
  }

  const result = await requestPasswordReset(body.email, { ip, requestId });

  if (result.token && result.name) {
    // Awaited so a mail outage does not silently swallow the request, but its
    // failure never changes the response.
    await sendPasswordReset({
      to: String(body.email),
      name: result.name,
      token: result.token,
    }).catch((err: unknown) =>
      logger.error("reset email failed", { err, userId: result.userId ?? undefined }),
    );
  }

  return ok(SAME_ANSWER);
});

export const PATCH = withRoute("PATCH /api/auth/password-reset", async (request, { requestId }) => {
  const body = await json<Record<string, unknown>>(request, 4096);
  await enforceRateLimit("password-reset:ip", clientIp(request) ?? "unknown");

  const { session, user } = await completePasswordReset(body, {
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
    requestId,
  });

  // Signed straight in on the new session; every older one is already revoked.
  return withCookies(ok({ user, csrfToken: session.csrfToken }), [
    sessionCookie(session.token, session.maxAge),
    csrfCookie(session.csrfToken, session.maxAge),
  ]);
});
