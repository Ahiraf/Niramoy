/**
 * PATCH /api/auth/password — change your own password.
 *
 * Requires the current password even though the caller is already signed in.
 * Without that, a hijacked session can lock the real owner out of their own
 * account; with it, the attacker needs the password they did not have.
 */
import { json, ok, withRoute } from "../../../../lib/api/respond";
import { csrfCookie, sessionCookie, withCookies } from "../../../../lib/auth/cookies";
import { requireUser } from "../../../../lib/security/authz";
import { changePassword } from "../../../../lib/services/auth";

export const dynamic = "force-dynamic";

export const PATCH = withRoute("PATCH /api/auth/password", async (request, { requestId }) => {
  const principal = await requireUser(request);
  const body = await json<Record<string, unknown>>(request, 4096);

  const { session } = await changePassword(principal.userId, principal.sessionId, body, {
    ip: null,
    userAgent: request.headers.get("user-agent"),
    requestId,
  });

  // Every other session was revoked; this one is rotated so the caller stays
  // signed in on a token that did not exist before the change.
  return withCookies(
    ok({ message: "Your password has been changed. Other devices have been signed out." }),
    [sessionCookie(session.token, session.maxAge), csrfCookie(session.csrfToken, session.maxAge)],
  );
});
