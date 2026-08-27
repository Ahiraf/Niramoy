/**
 * Niramoy — CSRF protection
 * -----------------------------------------------------------------------------
 * Cookie-based auth means the browser attaches credentials to cross-site
 * requests automatically, so a state-changing endpoint needs proof that the
 * request came from our own page. Two independent checks:
 *
 *   1. Origin / Referer must match APP_URL. Browsers set Origin on every
 *      cross-origin request and it cannot be forged by page script.
 *
 *   2. Double-submit: the value in the readable niramoy_csrf cookie must equal
 *      the x-niramoy-csrf header. An attacker's page can cause the cookie to be
 *      sent but cannot read it to set the header, because it is on our origin.
 *
 * The cookie value is compared against the secret stored on the session row, so
 * a token cannot be reused across sessions.
 *
 * Safe methods are exempt. They must not change state — if one does, that is
 * the bug to fix, not something to paper over here.
 */

import { AppError } from "../errors";
import { getEnv } from "../config/env";
import { CSRF_COOKIE, CSRF_HEADER, readCookie } from "./cookies";
import { constantTimeEqual } from "./tokens";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

function originAllowed(request: Request): boolean {
  const appUrl = getEnv().APP_URL;
  const expected = new URL(appUrl).origin;

  const origin = request.headers.get("origin");
  if (origin) return origin === expected;

  // Some clients omit Origin; fall back to Referer.
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }

  // Neither header present. A browser always sends at least one on a
  // state-changing same-origin request, so this is not a browser.
  return false;
}

/**
 * Throws CSRF_FAILED unless the request is provably from our own page.
 *
 * @param sessionCsrfSecret the secret stored on the session row
 */
export function assertCsrf(request: Request, sessionCsrfSecret: string): void {
  if (isSafeMethod(request.method)) return;

  if (!originAllowed(request)) {
    throw new AppError("CSRF_FAILED", {
      meta: { check: "origin", origin: request.headers.get("origin") },
    });
  }

  const cookie = readCookie(request, CSRF_COOKIE);
  const header = request.headers.get(CSRF_HEADER);

  if (!cookie || !header) {
    throw new AppError("CSRF_FAILED", { meta: { check: "missing_token" } });
  }
  if (!constantTimeEqual(cookie, header)) {
    throw new AppError("CSRF_FAILED", { meta: { check: "double_submit_mismatch" } });
  }
  if (!constantTimeEqual(cookie, sessionCsrfSecret)) {
    throw new AppError("CSRF_FAILED", { meta: { check: "not_this_session" } });
  }
}
