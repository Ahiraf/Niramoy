/**
 * POST /api/auth/login
 *
 * Rate limited, because a login endpoint without one is a credential-stuffing
 * endpoint. Limited on both the IP and the submitted email, so neither a single
 * host hammering many accounts nor many hosts hammering one account gets
 * through.
 */
import { json, ok, withRoute } from "../../../../lib/api/respond";
import { csrfCookie, sessionCookie, withCookies } from "../../../../lib/auth/cookies";
import { clientIp } from "../../../../lib/security/authz";
import { enforceRateLimit } from "../../../../lib/security/rate-limit";
import { login } from "../../../../lib/services/auth";

export const dynamic = "force-dynamic";

export const POST = withRoute("POST /api/auth/login", async (request, { requestId }) => {
  const body = await json<Record<string, unknown>>(request, 4096);
  const ip = clientIp(request);

  await enforceRateLimit("login:ip", ip ?? "unknown");
  if (body.email) await enforceRateLimit("login:email", String(body.email).toLowerCase());

  const { user, session } = await login(body, {
    ip,
    userAgent: request.headers.get("user-agent"),
    requestId,
  });

  return withCookies(ok({ user, csrfToken: session.csrfToken }), [
    sessionCookie(session.token, session.maxAge),
    csrfCookie(session.csrfToken, session.maxAge),
  ]);
});

