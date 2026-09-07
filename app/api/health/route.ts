/**
 * GET /api/health — liveness.
 *
 * "Is this process running and able to answer?" Deliberately does NOT touch the
 * database: a platform that restarts an instance because Postgres is briefly
 * unreachable turns a database blip into an outage. Readiness is the check that
 * looks at dependencies — see /api/ready.
 */
import { ok, withRoute } from "../../../lib/api/respond";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/health", async () =>
  ok({
    status: "ok",
    service: "niramoy",
    time: new Date().toISOString(),
  }),
);
