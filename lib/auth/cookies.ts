/**
 * Niramoy — auth cookies
 * -----------------------------------------------------------------------------
 * Two cookies, and the difference between them is the point:
 *
 *   niramoy_session  HttpOnly. The session token. Page scripts can never read
 *                    it, so an XSS bug cannot exfiltrate a session.
 *
 *   niramoy_csrf     NOT HttpOnly, deliberately. The double-submit token, which
 *                    the client must read and echo in a header. It carries no
 *                    authority on its own — it only proves the request came from
 *                    a page on our origin rather than from someone else's.
 *
 * SameSite=Lax rather than Strict: Strict would drop the session cookie on any
 * inbound navigation, so a user following an appointment-reminder link from
 * their email would land signed out. Lax still blocks cross-site POSTs, and the
 * CSRF token covers what remains.
 */

import { getEnv } from "../config/env";

export const SESSION_COOKIE = "niramoy_session";
export const CSRF_COOKIE = "niramoy_csrf";
export const CSRF_HEADER = "x-niramoy-csrf";

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Read one cookie from the raw request header. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1));
    }
  }
  return null;
}

interface CookieOptions {
  maxAge: number;
  httpOnly: boolean;
}

function serialise(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${options.maxAge}`,
  ];
  if (options.httpOnly) parts.push("HttpOnly");
  if (getEnv().isProd) parts.push("Secure");
  return parts.join("; ");
}

export function sessionCookie(token: string, maxAge = SESSION_TTL_SECONDS): string {
  return serialise(SESSION_COOKIE, token, { maxAge, httpOnly: true });
}

export function csrfCookie(token: string, maxAge = SESSION_TTL_SECONDS): string {
  return serialise(CSRF_COOKIE, token, { maxAge, httpOnly: false });
}

/** Both cookies expired. Used on sign-out and on an invalid session. */
export function clearAuthCookies(): string[] {
  return [
    serialise(SESSION_COOKIE, "", { maxAge: 0, httpOnly: true }),
    serialise(CSRF_COOKIE, "", { maxAge: 0, httpOnly: false }),
  ];
}

/** Attach several Set-Cookie headers to one response. */
export function withCookies(response: Response, cookies: string[]): Response {
  for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}
