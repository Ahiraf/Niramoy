/**
 * Drop every table and re-apply migrations, then seed.
 *
 *   npm run db:reset
 *
 * Development only. Refuses to run against production (brief §56: destructive
 * operations do not get to happen by accident).
 */
import "./_bootstrap";

import { sql } from "drizzle-orm";

import { getEnv } from "../lib/config/env";
import { closeDb, getDb } from "../lib/db/client";

async function main(): Promise<void> {
  const env = getEnv();
  if (env.isProd) {
    throw new Error("db:reset is destructive and refuses to run when APP_ENV=production");
  }

  const db = getDb();
  console.log(`▸ dropping schema (env: ${env.APP_ENV})`);
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  console.log("✓ schema dropped — run `npm run db:migrate && npm run db:seed`");
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("✗ reset failed");
    console.error(err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
