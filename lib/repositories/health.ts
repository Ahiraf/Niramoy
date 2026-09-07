/**
 * Database health probe.
 */
import { sql } from "drizzle-orm";

import { getDb, getDriver } from "../db/client";

export interface DatabaseHealth {
  ok: boolean;
  driver: string;
  latencyMs: number;
}

/** A trivial round trip. Cheap enough to run on every readiness check. */
export async function checkDatabase(): Promise<DatabaseHealth> {
  const startedAt = Date.now();
  await getDb().execute(sql`SELECT 1`);
  return { ok: true, driver: getDriver(), latencyMs: Date.now() - startedAt };
}
