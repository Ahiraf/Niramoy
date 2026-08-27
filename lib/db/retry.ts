/**
 * Retrying transient database failures.
 * -----------------------------------------------------------------------------
 * Concurrent inserts against an exclusion constraint genuinely deadlock. When
 * several transactions each hold a speculative lock on an overlapping range and
 * wait on one another, PostgreSQL breaks the cycle by aborting one with 40P01.
 * That is normal operation under contention, not a bug to design away — and it
 * is precisely why booking cannot be a single unretried statement.
 *
 * A conflict is NOT retried. If the slot is taken, trying again finds it taken;
 * retrying would only delay the 409. Only failures where the database is saying
 * "I could not serialise these, try once more" are worth repeating.
 */

import { isRetryable } from "./errors";
import { logger } from "../observability/logger";

export const MAX_ATTEMPTS = 4;

export interface RetryOptions {
  attempts?: number;
  label?: string;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? MAX_ATTEMPTS;
  const label = options.label ?? "db-operation";
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === attempts) throw err;

      // Exponential backoff with jitter. Without the jitter, two transactions
      // that just deadlocked would back off by the same amount and deadlock
      // again in lockstep.
      const backoff = 2 ** attempt * 5 + Math.random() * 25;
      logger.warn("retrying after a transient database failure", {
        label,
        attempt,
        backoffMs: Math.round(backoff),
      });
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  throw lastError;
}
