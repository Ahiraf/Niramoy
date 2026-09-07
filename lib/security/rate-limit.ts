/**
 * Niramoy — rate limiting
 * -----------------------------------------------------------------------------
 * Durable, shared across serverless invocations, never process memory.
 *
 * The default store is PostgreSQL. A fixed-window counter is a single atomic
 * `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count` — one
 * round trip, O(1) storage, and correct under concurrency because the increment
 * happens inside the statement rather than as read-then-write. An Upstash Redis
 * adapter sits behind the same interface for higher volume.
 *
 * Process memory is not an option, and not merely as a matter of taste: each
 * serverless invocation gets its own memory, so an in-process limiter of N per
 * minute actually permits N × (however many instances the platform spun up).
 * The limit would loosen exactly when traffic spiked.
 */

import { sql } from "drizzle-orm";

import { getDb } from "../db/client";
import { getEnv } from "../config/env";
import { AppError } from "../errors";
import { logger } from "../observability/logger";

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * The buckets from brief §21. Tuned to be invisible to a person using the app
 * normally and obstructive to a script.
 */
export const RATE_LIMITS = {
  "login:ip": { limit: 20, windowSeconds: 300 },
  "login:email": { limit: 8, windowSeconds: 300 },
  "register:ip": { limit: 5, windowSeconds: 3600 },
  "password-reset:ip": { limit: 5, windowSeconds: 3600 },
  "password-reset:email": { limit: 3, windowSeconds: 3600 },
  // Every send is a real SMS out of a real handset, so this bucket is about
  // somebody else's phone bill and somebody else's inbox, not just our load.
  // Three per hour covers a mistyped number and a resend; nothing more.
  "phone-verify:send": { limit: 3, windowSeconds: 3600 },
  /*
   * The sign-up code is the only endpoint in the application where somebody
   * with no account can make us text a stranger. Limited on both axes, because
   * either one alone is trivially defeated: per number, so nobody can be texted
   * repeatedly however many addresses the requests come from; per address, so
   * one script cannot walk a list of numbers. The IP bucket is the looser of
   * the two — a Bangladeshi mobile network puts a great many real people behind
   * one address, and locking them out to stop one script is the wrong trade.
   */
  "signup-otp:phone": { limit: 3, windowSeconds: 3600 },
  "signup-otp:ip": { limit: 15, windowSeconds: 3600 },
  "signup-otp:confirm": { limit: 20, windowSeconds: 900 },
  // The per-code guess cap is the real defence (see services/phone-verification);
  // this stops the same client working through fresh codes all afternoon.
  "phone-verify:confirm": { limit: 15, windowSeconds: 900 },
  "doctor-search": { limit: 120, windowSeconds: 60 },
  "appointment-book": { limit: 20, windowSeconds: 300 },
  // Confirming a wallet payment reaches out to the gateway, so a retry loop
  // here is chargeable traffic against the merchant account, not just ours.
  "payment-execute": { limit: 10, windowSeconds: 300 },
  // The AI buckets are tighter: each request costs inference money, and an
  // unbounded triage endpoint is a billing denial-of-service.
  "ai-triage": { limit: 15, windowSeconds: 300 },
  "ai-summary": { limit: 20, windowSeconds: 3600 },
  review: { limit: 10, windowSeconds: 3600 },
  "admin-action": { limit: 200, windowSeconds: 60 },
  "video-token": { limit: 30, windowSeconds: 300 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  increment(key: string, windowSeconds: number): Promise<{ count: number; resetAt: Date }>;
  /** Read the window without spending an attempt against it. */
  peek(key: string, windowSeconds: number): Promise<{ count: number; resetAt: Date }>;
}

/* -------------------------------------------------------------------------- */
/* PostgreSQL store (default)                                                  */
/* -------------------------------------------------------------------------- */

const postgresStore: RateLimitStore = {
  async increment(key, windowSeconds) {
    const db = getDb();
    // Truncate now() to the window, so every caller in the same window agrees
    // on the same bucket without coordinating.
    const rows = await db.execute<{ count: number; expires_at: Date }>(sql`
      INSERT INTO rate_limit_counters (key, window_start, count, expires_at)
      VALUES (
        ${key},
        to_timestamp(floor(extract(epoch FROM now()) / ${windowSeconds}) * ${windowSeconds}),
        1,
        to_timestamp(floor(extract(epoch FROM now()) / ${windowSeconds}) * ${windowSeconds})
          + make_interval(secs => ${windowSeconds})
      )
      ON CONFLICT (key, window_start)
      DO UPDATE SET count = rate_limit_counters.count + 1
      RETURNING count, expires_at
    `);

    const row = (rows as unknown as { rows?: unknown[] }).rows
      ? ((rows as unknown as { rows: { count: number; expires_at: string }[] }).rows[0])
      : ((rows as unknown as { count: number; expires_at: string }[])[0]);

    return {
      count: Number(row?.count ?? 1),
      resetAt: row?.expires_at ? new Date(row.expires_at) : new Date(Date.now() + windowSeconds * 1000),
    };
  },

  async peek(key, windowSeconds) {
    const db = getDb();
    const rows = await db.execute<{ count: number; expires_at: Date }>(sql`
      SELECT count, expires_at
      FROM rate_limit_counters
      WHERE key = ${key}
        AND window_start =
          to_timestamp(floor(extract(epoch FROM now()) / ${windowSeconds}) * ${windowSeconds})
    `);

    const row = (rows as unknown as { rows?: unknown[] }).rows
      ? ((rows as unknown as { rows: { count: number; expires_at: string }[] }).rows[0])
      : ((rows as unknown as { count: number; expires_at: string }[])[0]);

    // No row means nothing has been spent in this window yet.
    return {
      count: Number(row?.count ?? 0),
      resetAt: row?.expires_at ? new Date(row.expires_at) : new Date(Date.now() + windowSeconds * 1000),
    };
  },
};

/* -------------------------------------------------------------------------- */
/* Upstash Redis store (optional)                                              */
/* -------------------------------------------------------------------------- */

function redisStore(url: string, token: string): RateLimitStore {
  return {
    async increment(key, windowSeconds) {
      const window = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
      const redisKey = `rl:${key}:${window}`;

      const res = await fetch(`${url}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify([
          ["INCR", redisKey],
          ["EXPIRE", redisKey, String(windowSeconds)],
        ]),
      });
      if (!res.ok) throw new Error(`upstash ${res.status}`);

      const [incr] = (await res.json()) as { result: number }[];
      return {
        count: Number(incr?.result ?? 1),
        resetAt: new Date((window + windowSeconds) * 1000),
      };
    },

    async peek(key, windowSeconds) {
      const window = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
      const res = await fetch(`${url}/get/rl:${key}:${window}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`upstash ${res.status}`);

      const { result } = (await res.json()) as { result: string | null };
      return {
        count: Number(result ?? 0),
        resetAt: new Date((window + windowSeconds) * 1000),
      };
    },
  };
}

let cachedStore: RateLimitStore | undefined;

export function getRateLimitStore(): RateLimitStore {
  if (cachedStore) return cachedStore;
  const env = getEnv();
  cachedStore =
    env.RATE_LIMIT_STORE_URL && env.RATE_LIMIT_STORE_TOKEN
      ? redisStore(env.RATE_LIMIT_STORE_URL, env.RATE_LIMIT_STORE_TOKEN)
      : postgresStore;
  return cachedStore;
}

/** Test hook. */
export function resetRateLimitStore(): void {
  cachedStore = undefined;
}

export async function checkRateLimit(
  bucket: RateLimitBucket,
  subject: string,
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[bucket];
  const key = `${bucket}:${subject}`;

  try {
    const { count, resetAt } = await getRateLimitStore().increment(key, rule.windowSeconds);
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
    return {
      allowed: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSeconds,
    };
  } catch (err) {
    /**
     * The store is unreachable.
     *
     * Fail OPEN, deliberately. A rate limiter exists to preserve availability;
     * making its own outage take the whole application down inverts the point.
     * The event is logged at error so it is visible, and the controls that
     * actually protect data — authentication and authorization — are unaffected
     * because they do not depend on this.
     */
    logger.error("rate limit store unavailable; allowing request", { bucket, err });
    return { allowed: true, remaining: rule.limit, retryAfterSeconds: 0 };
  }
}

/**
 * Is this subject already over its limit? Does not spend an attempt.
 *
 * For endpoints that should charge for work done rather than for turning up:
 * peek at the door, and consume once the request has actually cost something.
 * Fails open on a store outage, for the reason given in `checkRateLimit`.
 */
export async function peekRateLimit(
  bucket: RateLimitBucket,
  subject: string,
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[bucket];

  try {
    const { count, resetAt } = await getRateLimitStore().peek(`${bucket}:${subject}`, rule.windowSeconds);
    return {
      allowed: count < rule.limit,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000)),
    };
  } catch (err) {
    logger.error("rate limit store unavailable; allowing request", { bucket, err });
    return { allowed: true, remaining: rule.limit, retryAfterSeconds: 0 };
  }
}

/**
 * How long to wait, in words.
 *
 * "Please wait a moment" is fine for fifteen seconds and false for the better
 * part of an hour. Somebody locked out deserves to know whether to try again
 * shortly or to go and do something else.
 */
export function describeWait(seconds: number): string {
  if (seconds <= 90) return "Please wait a moment and try again.";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `Please try again in ${minutes} minutes.`;
  const hours = Math.round(minutes / 60);
  return `Please try again in about ${hours === 1 ? "an hour" : `${hours} hours`}.`;
}

function rateLimited(bucket: RateLimitBucket, retryAfterSeconds: number): AppError {
  return new AppError("RATE_LIMITED", {
    message: `Too many attempts. ${describeWait(retryAfterSeconds)}`,
    retryAfter: retryAfterSeconds,
    meta: { bucket },
  });
}

/** Check and throw 429 when over. */
export async function enforceRateLimit(
  bucket: RateLimitBucket,
  subject: string,
): Promise<void> {
  const result = await checkRateLimit(bucket, subject);
  if (!result.allowed) throw rateLimited(bucket, result.retryAfterSeconds);
}

/** Throw 429 if already over, without spending an attempt. */
export async function enforceRateLimitPeek(
  bucket: RateLimitBucket,
  subject: string,
): Promise<void> {
  const result = await peekRateLimit(bucket, subject);
  if (!result.allowed) throw rateLimited(bucket, result.retryAfterSeconds);
}

/** Spend one attempt, for a request that has now done the work. */
export async function consumeRateLimit(
  bucket: RateLimitBucket,
  subject: string,
): Promise<void> {
  await checkRateLimit(bucket, subject);
}

/** Housekeeping for the cron sweep. */
export async function purgeExpiredCounters(): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(
    sql`WITH deleted AS (DELETE FROM rate_limit_counters WHERE expires_at < now() RETURNING 1)
        SELECT count(*)::int AS n FROM deleted`,
  );
  const row = (rows as unknown as { rows?: { n: number }[] }).rows?.[0]
    ?? (rows as unknown as { n: number }[])[0];
  return Number(row?.n ?? 0);
}
