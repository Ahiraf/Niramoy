/**
 * Niramoy — password hashing
 * -----------------------------------------------------------------------------
 * Argon2id for new passwords. scrypt is kept as a verifier only, so hashes made
 * by the prototype keep working and are re-hashed to Argon2id on the next
 * successful sign-in — nobody has to reset a password for the upgrade.
 *
 * Never log, return or serialise anything from this module.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export type PasswordAlgo = "scrypt" | "argon2id";

const SCRYPT_KEY_BYTES = 64;
const SALT_BYTES = 16;

/**
 * OWASP's second recommended Argon2id configuration (19 MiB, t=2, p=1).
 * Memory cost is the parameter that matters against GPU attack; raising the
 * time cost instead buys much less for the same latency.
 */
// `Algorithm` is an ambient const enum, which isolatedModules cannot read
// across a module boundary; 2 is Argon2id.
const ARGON2ID = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** A password longer than this is rejected before hashing — see the DoS note. */
export const MAX_PASSWORD_BYTES = 1024;

export interface HashedPassword {
  hash: string;
  algo: PasswordAlgo;
}

export async function hashPassword(password: string): Promise<HashedPassword> {
  assertHashable(password);
  return { hash: await argon2Hash(password, ARGON2_OPTIONS), algo: "argon2id" };
}

/** Legacy. Retained so the migration path can be tested, not for new hashes. */
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
  // Lengths must match before timingSafeEqual, which throws otherwise.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Hashing an unbounded string is a denial-of-service surface: Argon2 work is
 * linear in input length, and an attacker controls it. The cap is far above any
 * real passphrase.
 */
function assertHashable(password: string): void {
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    throw new Error("password exceeds the maximum hashable length");
  }
}

export async function verifyPassword(
  password: string,
  stored: string,
  algo: PasswordAlgo,
): Promise<boolean> {
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) return false;

  switch (algo) {
    case "argon2id":
      // Throws on a malformed hash rather than returning false; treat that as a
      // failed verification, not a 500.
      return argon2Verify(stored, password, ARGON2_OPTIONS).catch(() => false);
    case "scrypt":
      return verifyScrypt(password, stored);
    default:
      return false;
  }
}

/** True when a stored hash should be upgraded after a successful sign-in. */
export function needsRehash(algo: PasswordAlgo): boolean {
  return algo !== "argon2id";
}

/**
 * A dummy verification, run when no account matches the submitted email.
 *
 * Without it, "no such user" returns in microseconds while a real account costs
 * an Argon2 hash — a timing oracle that enumerates accounts regardless of what
 * the response body says.
 */
const DUMMY_HASH_PROMISE = argon2Hash("niramoy-timing-equaliser", ARGON2_OPTIONS);

export async function burnPasswordTime(password: string): Promise<void> {
  const dummy = await DUMMY_HASH_PROMISE;
  await argon2Verify(dummy, password.slice(0, MAX_PASSWORD_BYTES), ARGON2_OPTIONS).catch(() => false);
}

/**
 * Password policy, checked server-side so a client cannot skip it.
 * Returns unmet requirements; empty means acceptable.
 */
export function checkPasswordStrength(password: string): string[] {
  const problems: string[] = [];
  if (!password || password.length < 8) problems.push("Use at least 8 characters.");
  if (!/[a-zA-Z]/.test(password)) problems.push("Include at least one letter.");
  if (!/[0-9]/.test(password)) problems.push("Include at least one number.");
  if (Buffer.byteLength(password ?? "", "utf8") > MAX_PASSWORD_BYTES) {
    problems.push("That password is too long.");
  }
  return problems;
}
