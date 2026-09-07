/**
 * Niramoy — the model credential chain
 * -----------------------------------------------------------------------------
 * One request shape, several credentials, tried in order until one answers:
 *
 *     Gemini key 1  →  Gemini key 2  →  Gemini key 3  →  OpenAI
 *
 * Why a chain at all: a free-tier quota is per key and per day, so the
 * assistant would otherwise go quiet in the middle of an afternoon with no
 * warning. Three Gemini keys cover that; OpenAI is the last resort because it
 * is the one that costs money, so it should be reached only when the free ones
 * are genuinely spent.
 *
 * Why one request shape: Google publishes an OpenAI-compatible endpoint
 * (`/v1beta/openai/chat/completions`), which speaks the same JSON, the same
 * `Authorization: Bearer`, and the same `response_format: json_object` that the
 * OpenAI API does. So every credential here is called identically, and adding a
 * fourth provider means adding a row to a list rather than a branch to a
 * function.
 *
 * What this is NOT: a capacity or cost strategy, and not a retry loop for a
 * flaky network. It moves to the next credential when the current one will not
 * serve this request, and when the list is exhausted it says so. Callers then
 * fall back to their deterministic result — the triage rules, the undrafted
 * summary. Nothing in this file may turn "no model answered" into a clinical
 * answer, which is why it returns `null` rather than throwing something a
 * caller might paper over.
 */

import { getEnv } from "../config/env";
import { logger } from "../observability/logger";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_MODEL = "gemini-2.5-flash";
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENAI_MODEL = "gpt-4o-mini";

export interface Credential {
  /** Stable name for logs and result metadata. Never the key itself. */
  id: string;
  provider: "gemini" | "openai" | "custom";
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatResult {
  /** The raw assistant message. Parsing and validation belong to the caller. */
  content: unknown;
  credentialId: string;
  provider: Credential["provider"];
  model: string;
  /** How many credentials were tried before this one answered. */
  attempts: number;
}

/**
 * The chain, in the order it is tried.
 *
 * Read fresh each call rather than cached at module load, so a test — or a
 * deployment that rotates a key — sees the current environment. Building this
 * list is cheap; getting it wrong for the lifetime of a process is not.
 */
export function credentialChain(): Credential[] {
  const env = getEnv();
  const chain: Credential[] = [];

  const geminiKeys = [env.GEMINI_API_KEY_1, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3];
  geminiKeys.forEach((key, i) => {
    if (!key) return;
    chain.push({
      id: `gemini-${i + 1}`,
      provider: "gemini",
      baseUrl: env.GEMINI_BASE_URL ?? GEMINI_BASE_URL,
      apiKey: key,
      model: env.GEMINI_MODEL ?? GEMINI_MODEL,
    });
  });

  if (env.OPENAI_API_KEY) {
    chain.push({
      id: "openai",
      provider: "openai",
      baseUrl: env.OPENAI_BASE_URL ?? OPENAI_BASE_URL,
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL ?? OPENAI_MODEL,
    });
  }

  /*
   * The single-endpoint configuration this project had before the chain
   * existed. Kept, and kept last: an installation that configures only this
   * still behaves exactly as it did, and one that has since added Gemini and
   * OpenAI keys gets those first.
   */
  if (env.AI_API_KEY && env.AI_BASE_URL) {
    chain.push({
      id: "custom",
      provider: "custom",
      baseUrl: env.AI_BASE_URL,
      apiKey: env.AI_API_KEY,
      model: env.AI_MODEL ?? OPENAI_MODEL,
    });
  }

  return chain;
}

/* -------------------------------------------------------------------------- */
/* Remembering which keys are spent                                            */
/* -------------------------------------------------------------------------- */

/**
 * Credentials known to be rate-limited, and when to try them again.
 *
 * Without this, every request during a quota outage pays three failed calls
 * before reaching the key that works — slow for the patient waiting on triage,
 * and three more requests against a quota that is already over.
 *
 * This is process memory, deliberately, and it is worth being clear about what
 * that costs. Each serverless instance learns separately, so the first request
 * on a cold instance still pays the failures. That is acceptable here in a way
 * it is not for rate limiting (see lib/security/rate-limit.ts, which refuses
 * process memory for exactly this reason): being wrong costs one wasted API
 * call, not a limit that fails to limit. Nothing about correctness depends on
 * this map — it is an optimisation over a chain that is already correct.
 */
const coolingOff = new Map<string, number>();

/** The default rest for a key that reported a limit and gave no Retry-After. */
const DEFAULT_COOLDOWN_MS = 60_000;
/** However long a provider asks for, we re-check within the hour. */
const MAX_COOLDOWN_MS = 60 * 60_000;

function isCoolingOff(id: string, now: number): boolean {
  const until = coolingOff.get(id);
  if (until === undefined) return false;
  if (until <= now) {
    coolingOff.delete(id);
    return false;
  }
  return true;
}

function coolOff(id: string, retryAfterHeader: string | null, now: number): void {
  // `>= 0`, not `> 0`: "Retry-After: 0" is a provider saying it is ready now,
  // which is a shorter rest than the default rather than no header at all.
  const seconds = Number(retryAfterHeader);
  const wait =
    retryAfterHeader !== null && Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000
      : DEFAULT_COOLDOWN_MS;
  coolingOff.set(id, now + Math.min(wait, MAX_COOLDOWN_MS));
}

/** Test hook, and useful after rotating keys. */
export function resetCredentialState(): void {
  coolingOff.clear();
}

/* -------------------------------------------------------------------------- */
/* The call                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Should the next credential be tried, given how this one answered?
 *
 * 429 is the case the chain exists for: this key is done for now. 401 and 403
 * mean the key is rejected, which the next one may not be. 5xx and network
 * failures are the provider's problem, and the next credential may be a
 * different provider entirely.
 *
 * 400 is the exception that stops the chain. A malformed request is malformed
 * for every key, so walking the list would mean four identical rejections and
 * four times the latency to reach the same answer.
 */
function shouldAdvance(status: number): boolean {
  return status !== 400;
}

export interface ChatOptions {
  /** Per-attempt timeout. */
  timeoutMs: number;
  /**
   * Total time the whole chain may take. Fast failures (a 429 comes back
   * immediately) still walk the entire list; slow ones stop early rather than
   * stacking four timeouts onto somebody waiting for a triage answer.
   */
  budgetMs?: number;
  temperature?: number;
}

/**
 * Ask the chain for one JSON object. Returns null when nothing answered.
 *
 * The caller supplies the messages and validates whatever comes back — this
 * function knows nothing about triage or summaries, and must not, because the
 * safety rules that make those outputs usable live with them.
 */
export async function chatJson(
  messages: ChatMessage[],
  options: ChatOptions,
): Promise<ChatResult | null> {
  const chain = credentialChain();
  if (!chain.length) return null;

  const startedAt = Date.now();
  const budgetMs = options.budgetMs ?? options.timeoutMs * 2;
  let attempts = 0;

  for (const credential of chain) {
    const now = Date.now();

    if (isCoolingOff(credential.id, now)) {
      logger.debug("skipping model credential that reported a limit", {
        credential: credential.id,
      });
      continue;
    }

    // Out of time. Whatever is left in the chain does not get tried, and the
    // caller falls back — which is a defined, safe outcome, not an error.
    if (attempts > 0 && now - startedAt >= budgetMs) {
      logger.warn("model chain budget exhausted", { attempts, budgetMs });
      break;
    }

    attempts += 1;

    try {
      const response = await fetch(`${credential.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credential.apiKey}`,
        },
        signal: AbortSignal.timeout(options.timeoutMs),
        body: JSON.stringify({
          model: credential.model,
          temperature: options.temperature ?? 0.2,
          response_format: { type: "json_object" },
          messages,
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          coolOff(credential.id, response.headers.get("retry-after"), Date.now());
        }

        // The key is never logged, and neither is the body: an upstream error
        // page can quote back the request, and the request is patient text.
        logger.warn("model credential did not serve the request", {
          credential: credential.id,
          provider: credential.provider,
          status: response.status,
        });

        if (!shouldAdvance(response.status)) break;
        continue;
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };

      return {
        content: body.choices?.[0]?.message?.content,
        credentialId: credential.id,
        provider: credential.provider,
        model: credential.model,
        attempts,
      };
    } catch (err) {
      // A timeout or a network failure. The next credential may be a different
      // provider on a different network path, so it is worth trying.
      logger.warn("model credential unreachable", {
        credential: credential.id,
        provider: credential.provider,
        err,
      });
    }
  }

  logger.warn("every model credential failed; falling back", { attempts });
  return null;
}
