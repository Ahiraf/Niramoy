/**
 * Integration-test database harness.
 *
 * Each suite gets a fresh, migrated, in-memory PostgreSQL. PGlite is real
 * Postgres compiled to WASM, so CHECK constraints, triggers and the btree_gist
 * EXCLUDE constraint behave exactly as they do on a server — which is the point:
 * a test that skipped them would not be testing the thing that protects us.
 *
 * PGlite is single-connection, so it cannot exercise genuine concurrency. Those
 * tests live in *.concurrency.test.ts and run against DATABASE_URL_TEST.
 */
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "../lib/db/schema";

export type TestDb = PgliteDatabase<typeof schema> & { $client: PGlite };

export interface TestDatabase {
  db: TestDb;
  client: PGlite;
  close: () => Promise<void>;
  /** Empty every table but keep the schema. Faster than re-migrating. */
  truncate: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite("memory://", { extensions: { btree_gist } } as never);
  const db = drizzle(client, { schema, casing: "snake_case" }) as TestDb;

  await migrate(db as never, { migrationsFolder: "./lib/db/migrations" });

  return {
    db,
    client,
    close: () => client.close(),
    truncate: async () => {
      const { rows } = await client.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables
         WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'`,
      );
      if (!rows.length) return;
      const list = rows.map((r) => `"${r.tablename}"`).join(", ");
      // The append-only triggers reject DELETE; TRUNCATE bypasses row triggers,
      // which is correct here — we are resetting a fixture, not editing history.
      await client.exec(`TRUNCATE ${list} RESTART IDENTITY CASCADE;`);
    },
  };
}
