/**
 * Niramoy — password hashing
 * -----------------------------------------------------------------------------
 * Phase 1 provides scrypt, which is what the prototype used and what the seed
 * needs. Phase 2 adds Argon2id as the default and keeps `verifyPassword`
 * dispatching on the stored algorithm, so existing hashes keep working and are
 * upgraded transparently on the next successful sign-in.
 *
 * Never log, return or serialise anything from this module.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export type PasswordAlgo = "scrypt" | "argon2id";

const SCRYPT_KEY_BYTES = 64;
const SALT_BYTES = 16;

export interface HashedPassword {
  hash: string;
  algo: PasswordAlgo;
}

export async function hashScrypt(password: string): Promise<HashedPassword> {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const derived = await scrypt(password, salt, SCRYPT_KEY_BYTES);
  return { hash: `${salt}:${derived.toString("hex")}`, algo: "scrypt" };
}

async function verifyScrypt(password: string, stored: string): Promise<boolean> {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;

  const expected = Buffer.from(digest, "hex");
  const actual = await scrypt(password, salt, SCRYPT_KEY_BYTES);
  // Length must match before timingSafeEqual, which throws otherwise.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Verify a password against a stored hash, dispatching on the algorithm the
 * hash was created with.
 */
export async function verifyPassword(
  password: string,
  stored: string,
  algo: PasswordAlgo,
): Promise<boolean> {
  switch (algo) {
    case "scrypt":
      return verifyScrypt(password, stored);
    case "argon2id":
      // Implemented in Phase 2. Failing closed is the only safe placeholder.
      throw new Error("argon2id verification is not available until Phase 2");
    default:
      return false;
  }
}

/** The default for new passwords. Becomes "argon2id" in Phase 2. */
export const DEFAULT_ALGO: PasswordAlgo = "scrypt";

export async function hashPassword(password: string): Promise<HashedPassword> {
  return hashScrypt(password);
}

/**
 * Password policy, checked server-side so a client cannot skip it.
 * Returns the list of unmet requirements; empty means acceptable.
 */
export function checkPasswordStrength(password: string): string[] {
  const problems: string[] = [];
  if (!password || password.length < 8) problems.push("Use at least 8 characters.");
  if (!/[a-zA-Z]/.test(password)) problems.push("Include at least one letter.");
  if (!/[0-9]/.test(password)) problems.push("Include at least one number.");
  if (password.length > 200) problems.push("That password is too long.");
  return problems;
}
