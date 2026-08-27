/**
 * Niramoy — opaque tokens
 * -----------------------------------------------------------------------------
 * Session tokens, email-verification tokens and password-reset tokens are all
 * the same primitive: 32 random bytes handed to the user, and only a SHA-256
 * hash kept in the database.
 *
 * Storing the hash means a database leak does not hand out live sessions or
 * usable reset links. These tokens are high-entropy random values, not
 * passwords, so a fast hash is the right choice — there is nothing to brute
 * force.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Constant-time comparison of two arbitrary strings. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Hash an IP address or user agent for storage.
 *
 * These are personal data on their own, and we only ever need to answer "is
 * this the same client as before?" — never "which client was it?". Keyed with
 * the session secret so the digests are not comparable across deployments and
 * cannot be reversed with a rainbow table of the IPv4 space.
 */
export function hashClientAttribute(value: string | null | undefined, secret: string): string | null {
  if (!value) return null;
  return createHash("sha256").update(`${secret}:${value}`).digest("hex");
}
