/**
 * Apply pending migrations.
 *
 *   npm run db:migrate
 *
 * Uses the non-pooled connection string when one is configured: a pooler can cut
 * a long DDL transaction, and a half-applied migration is much worse than a slow
 * one. Every migration runs inside a transaction, so a failure rolls back.
 */
import "./_bootstrap";

import { getEnv } from "../lib/config/env";
import { closeDb, getDb, getDriver } from "../lib/db/client";

const MIGRATIONS_FOLDER = "./lib/db/migrations";

async function main(): Promise<void> {
  const env = getEnv();
  const driver = getDriver();
  const db = getDb();

  console.log(`▸ migrating (driver: ${driver}, env: ${env.APP_ENV})`);
  if (driver === "pglite") {
    console.log("  using the in-process PGlite database — set DATABASE_URL for a real server");
  }

  const started = Date.now();

  switch (driver) {
    case "neon": {
      const { migrate } = await import("drizzle-orm/neon-http/migrator");
      await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
      break;
    }
    case "pg": {
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
      break;
    }
    default: {
      const { migrate } = await import("drizzle-orm/pglite/migrator");
      await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
      break;
    }
  }

  console.log(`✓ migrations applied in ${Date.now() - started}ms`);
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("✗ migration failed");
    console.error(err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
