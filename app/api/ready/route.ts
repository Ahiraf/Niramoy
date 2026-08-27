/**
 * GET /api/ready — readiness.
 *
 * "Can this instance serve traffic right now?" Checks the dependencies that a
 * request actually needs. Returns 503 when it cannot, so a load balancer stops
 * sending work here instead of serving errors.
 *
 * Reports which driver is in use, because "ready" while running on the
 * in-process PGlite database is a very different state from "ready" on Neon,
 * and an operator should not have to guess which one they are looking at.
 */
import { ok, withRoute } from "../../../lib/api/respond";
import { AppError } from "../../../lib/errors";
import { getEnv } from "../../../lib/config/env";
import { checkDatabase } from "../../../lib/repositories/health";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/ready", async (_request, { logger }) => {
  const env = getEnv();
  const startedAt = Date.now();

  const database = await checkDatabase().catch((err: unknown) => {
    logger.error("readiness: database unreachable", { err });
    return { ok: false as const, driver: env.databaseDriver, latencyMs: Date.now() - startedAt };
  });

  if (!database.ok) {
    throw new AppError("DATABASE_UNAVAILABLE", {
      meta: { driver: database.driver },
    });
  }

  return ok({
    status: "ready",
    time: new Date().toISOString(),
    checks: {
      database: {
        ok: true,
        driver: database.driver,
        latencyMs: database.latencyMs,
        // Loud on purpose: PGlite is not a production database.
        ephemeral: database.driver === "pglite",
      },
    },
    providers: {
      ai: env.aiProvider,
      email: env.emailProvider,
      video: env.videoProvider,
      payment: env.paymentProvider,
      bmdc: env.BMDC_API_URL ? "api" : "manual_admin_review",
    },
  });
});
