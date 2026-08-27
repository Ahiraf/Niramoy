/**
 * Niramoy — security headers
 * -----------------------------------------------------------------------------
 * The Content-Security-Policy is the one that does real work here. A health
 * application's worst XSS outcome is not a defaced page, it is a script reading
 * a patient's records and posting them elsewhere — so `connect-src` matters as
 * much as `script-src`.
 *
 * The video provider needs a scoped exception, because an embedded consultation
 * is a frame from another origin. It is scoped to the configured provider's
 * domain rather than opened with a wildcard.
 */

import { getEnv } from "../config/env";

/** The video provider's origins, or nothing when none is configured. */
function videoOrigins(): { frame: string[]; connect: string[] } {
  const env = getEnv();

  switch (env.videoProvider) {
    case "daily":
      return {
        frame: ["https://*.daily.co"],
        connect: ["https://*.daily.co", "wss://*.daily.co", "https://*.wss.daily.co"],
      };
    case "jitsi": {
      const domain = env.VIDEO_DOMAIN ?? "meet.jit.si";
      return { frame: [`https://${domain}`], connect: [`https://${domain}`, `wss://${domain}`] };
    }
    default:
      // The demo provider embeds nothing, so nothing is allowed.
      return { frame: [], connect: [] };
  }
}

export function contentSecurityPolicy(): string {
  const env = getEnv();
  const video = videoOrigins();

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],

    /**
     * 'unsafe-inline' is required by Next's hydration bootstrap. It is a real
     * weakening and is recorded as such in docs/SECURITY.md rather than left
     * looking deliberate. Removing it means adopting nonces throughout, which
     * is tracked as a hardening item.
     */
    "script-src": ["'self'", "'unsafe-inline'", ...(env.isProd ? [] : ["'unsafe-eval'"])],

    // Next injects styles inline; there is no way around this one either.
    "style-src": ["'self'", "'unsafe-inline'"],

    "img-src": ["'self'", "data:", "blob:", ...video.frame],
    "font-src": ["'self'", "data:"],

    // Where the page may send data. The important one: a script that gets in
    // cannot exfiltrate to an arbitrary host.
    "connect-src": ["'self'", ...video.connect],

    // The consultation iframe, scoped to the configured provider only.
    "frame-src": ["'self'", ...video.frame],

    // Camera and microphone need media access from the provider's frame.
    "media-src": ["'self'", "blob:", ...video.frame],

    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    // Nobody frames us. Clickjacking a "cancel appointment" button is cheap.
    "frame-ancestors": ["'none'"],
  };

  if (env.isProd) directives["upgrade-insecure-requests"] = [];

  return Object.entries(directives)
    .map(([name, values]) => (values.length ? `${name} ${values.join(" ")}` : name))
    .join("; ");
}

export function securityHeaders(): Record<string, string> {
  const env = getEnv();
  const video = videoOrigins();

  const headers: Record<string, string> = {
    "Content-Security-Policy": contentSecurityPolicy(),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    // Never leak a URL containing an appointment or record id to another site.
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-DNS-Prefetch-Control": "off",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };

  /**
   * Camera and microphone are granted to self and to the video provider only.
   * With no provider configured they are denied outright — a telemedicine app
   * that requests camera access it cannot use is asking users to grant a
   * permission for nothing.
   */
  const mediaAllowList = ["'self'", ...video.frame.map((origin) => `"${origin}"`)].join(" ");
  headers["Permissions-Policy"] = [
    `camera=(${video.frame.length ? mediaAllowList : ""})`,
    `microphone=(${video.frame.length ? mediaAllowList : ""})`,
    "geolocation=()",
    "payment=()",
    "usb=()",
    "magnetometer=()",
    "accelerometer=()",
    "gyroscope=()",
    "interest-cohort=()",
  ].join(", ");

  if (env.isProd) {
    headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload";
  }

  return headers;
}
