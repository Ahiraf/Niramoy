/**
 * Niramoy — HTTP response envelope
 * -----------------------------------------------------------------------------
 * One place decides what a response looks like, what status it carries, and how
 * much of an error the caller is allowed to see.
 *
 * The envelope carries two shapes at once during the migration:
 *
 *   { ok: false, error: { code, message }, reason, message }
 *              └─ the new contract          └─ what the existing frontend reads
 *
 * `app/lib/api.js` and every component branch on `reason`, so dropping it would
 * break the UI for no benefit. New clients read `error.code`. The legacy fields
 * are removed once the frontend has moved (docs/IMPLEMENTATION_PLAN.md, D3).
 */

import { AppError, LEGACY_REASON, toAppError } from "../errors";
import { createLogger, newRequestId, type Logger } from "../observability/logger";

export interface RouteContext {
  requestId: string;
  logger: Logger;
}

/** A successful response. `data` is spread, matching the prototype's shape. */
export function ok<T extends Record<string, unknown>>(
  data: T,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return Response.json(
    { ok: true, ...data },
    { status: init.status ?? 200, headers: init.headers },
  );
}

export function created<T extends Record<string, unknown>>(data: T): Response {
  return ok(data, { status: 201 });
}

/** An error response. Never includes a stack, a cause, or internal metadata. */
export function fail(error: AppError, requestId?: string): Response {
  const headers: Record<string, string> = {};
  if (requestId) headers["X-Request-Id"] = requestId;
  if (error.retryAfter) headers["Retry-After"] = String(error.retryAfter);

  return Response.json(
    {
      ok: false,
      error: error.toJSON(),
      // Legacy fields. See the note at the top of this file.
      reason: LEGACY_REASON[error.code],
      message: error.message,
    },
    { status: error.status, headers },
  );
}

type Handler<Args extends unknown[]> = (
  request: Request,
  context: RouteContext,
  ...args: Args
) => Promise<Response>;

/**
 * Wrap a route handler.
 *
 * Gives it a request id and a bound logger, times it, and turns anything thrown
 * into a safe response. A handler never has to write a try/catch, and an
 * unexpected throw can never leak a driver message to a client.
 */
export function withRoute<Args extends unknown[]>(
  route: string,
  handler: Handler<Args>,
): (request: Request, ...args: Args) => Promise<Response> {
  return async (request: Request, ...args: Args): Promise<Response> => {
    const requestId = request.headers.get("x-request-id") ?? newRequestId();
    const logger = createLogger({ requestId, route, method: request.method });
    const startedAt = Date.now();

    try {
      const response = await handler(request, { requestId, logger }, ...args);
      logger.info("request completed", {
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      response.headers.set("X-Request-Id", requestId);
      return response;
    } catch (thrown) {
      const error = toAppError(thrown);

      // Expected business-rule failures are normal traffic, not incidents.
      const level = error.expected ? "info" : "error";
      logger[level]("request failed", {
        status: error.status,
        code: error.code,
        durationMs: Date.now() - startedAt,
        ...(error.meta ?? {}),
        ...(error.expected ? {} : { err: thrown }),
      });

      return fail(error, requestId);
    }
  };
}

/** Parsed query string as a plain object. */
export function query(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams);
}

/**
 * Parse a JSON body, capped. An unbounded body is a denial-of-service surface
 * and, on the AI routes, a cost surface too (brief §21).
 */
export async function json<T = unknown>(request: Request, maxBytes = 64 * 1024): Promise<T> {
  const raw = await request.text();
  if (raw.length > maxBytes) {
    throw new AppError("INPUT_TOO_LARGE", { meta: { bytes: raw.length, maxBytes } });
  }
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new AppError("VALIDATION_FAILED", { message: "The request body wasn't valid JSON." });
  }
}
