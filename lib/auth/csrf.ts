/**
 * Niramoy — CSRF protection
 * -----------------------------------------------------------------------------
 * Cookie-based auth means the browser attaches credentials to cross-site
 * requests automatically, so a state-changing endpoint needs proof that the
 * request came from our own page. Two independent checks:
 *
 *   1. Origin / Referer must match the origin this request was addressed to
 *      (or APP_URL, pinned strictly when production names one). Browsers set
 *      Origin on every cross-origin request and page script cannot forge it.
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

/**
 * The origin the request was actually addressed to, from the proxy headers if
 * there is a proxy and the Host header otherwise.
 *
 * Safe to compare Origin against, and this is the check every framework
 * ultimately makes. A browser sets Host to *our* host and Origin to the
 * *initiating page's* origin, and page script can forge neither, so equality
 * proves the request came from a page on this same host. A non-browser client
 * can set both headers freely — but it has no victim's cookies to ride on,
 * which is the only thing CSRF is about.
 */
function selfOrigin(request: Request): string | null {
  const headers = request.headers;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return null;

  // Behind a proxy the scheme is only in the forwarded header; without one the
  // request URL already carries the scheme the server is actually serving.
  let proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (!proto) {
    try {
      proto = new URL(request.url).protocol.replace(":", "");
    } catch {
      return null;
    }
  }

  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

/**
 * The origins a state-changing request may claim to come from.
 *
 * Pinning this to APP_URL alone was a real bug, not a theoretical one: the
 * default is http://localhost:3000, so a second `next dev` on :3001, a phone
 * hitting the LAN address, or a preview deployment on its generated hostname
 * all failed every write while sign-in and every read still worked — because
 * CSRF is only checked once a session exists. It surfaced as "Confirm
 * appointment does nothing".
 *
 * So: a deployer who explicitly sets APP_URL in production still gets that one
 * origin and nothing else. Everywhere else — development, test, and a
 * production deploy that never named its own URL — the request's own origin is
 * accepted too, which is the check that was wanted all along.
 */
function allowedOrigins(request: Request): string[] {
  const env = getEnv();
  const origins = [new URL(env.APP_URL).origin];

  if (!(env.isProd && env.appUrlConfigured)) {
    const self = selfOrigin(request);
    if (self) origins.push(self);
  }
  return origins;
}

function originAllowed(request: Request): boolean {
  const allowed = allowedOrigins(request);

  const origin = request.headers.get("origin");
  if (origin) return allowed.includes(origin);

  // Some clients omit Origin; fall back to Referer.
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return allowed.includes(new URL(referer).origin);
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
