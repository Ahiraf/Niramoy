/**
 * POST /api/cron/:job — run a scheduled job.
 *
 * Authenticated by a shared secret, compared in constant time. These endpoints
 * mutate appointment status and send mail; an unauthenticated one would let
 * anyone mark the platform's appointments as missed.
 *
 * The secret goes in a header, never a query string: query strings end up in
 * access logs, browser history and referrer headers.
 */
import { ok, withRoute } from "../../../../lib/api/respond";
import { getEnv } from "../../../../lib/config/env";
import { AppError } from "../../../../lib/errors";
import { JOBS, type JobName } from "../../../../lib/services/jobs";

export const dynamic = "force-dynamic";

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. */
function assertCronSecret(request: Request): void {
  const expected = getEnv().cronSecret;
  if (!expected) {
    throw new AppError("INTERNAL", { meta: { reason: "CRON_SECRET is not configured" } });
  }

  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (supplied.length !== expected.length) throw new AppError("FORBIDDEN");

  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) throw new AppError("FORBIDDEN");
}

export const POST = withRoute(
  "POST /api/cron/[job]",
  async (request, { logger }, { params }: { params: Promise<{ job: string }> }) => {
    assertCronSecret(request);

    const { job } = await params;
    const runner = JOBS[job as JobName];
    if (!runner) throw new AppError("NOT_FOUND", { meta: { job } });

    const started = Date.now();
    const result = await runner();

    logger.info("cron job finished", {
      job,
      skipped: result.skipped,
      processed: result.processed,
      durationMs: Date.now() - started,
    });

    return ok({ result });
  },
);
