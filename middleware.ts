/**
 * Applies security headers to every response.
 *
 * In middleware rather than next.config so the policy can depend on runtime
 * configuration — the CSP has to name the configured video provider's origins,
 * which are not known at build time.
 */
import { NextResponse, type NextRequest } from "next/server";

import { securityHeaders } from "./lib/security/headers";

export function middleware(request: NextRequest): NextResponse {
  const response = NextResponse.next();

  for (const [name, value] of Object.entries(securityHeaders())) {
    response.headers.set(name, value);
  }

  // Correlates the access log with the application log for the same request.
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  response.headers.set("X-Request-Id", requestId);

  return response;
}

export const config = {
  // Everything except Next's own static output, which needs no policy and is
  // served often enough that the header cost is worth avoiding.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
