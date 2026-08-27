/**
 * Niramoy — database client
 * -----------------------------------------------------------------------------
 * ONLY lib/repositories/* may import this module. The ESLint config enforces it.
 * Services and route handlers go through a repository so that the persistence
 * choice stays swappable and every query has one home.
 *
 * Three drivers, chosen from the environment (lib/config/env.ts):
 *
 *   neon   — Vercel Postgres / Neon over HTTP. No socket to keep alive, which is
 *            the right shape for short-lived serverless invocations.
 *   pg     — node-postgres with a small pool, for a normal server, Docker, and
 *            the concurrency test suite (which needs real parallel connections).
 *   pglite — Postgres compiled to WASM, in-process. The default when no
 *            DATABASE_URL is set, so `npm run dev` and `npm test` work on a
 *            clean checkout. Refused in production by the env validator.
 *
 * Serverless note (brief §48/§49): the client is cached on `globalThis` so a warm
 * invocation reuses it rather than opening a new pool per request.
 */

import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzleNode, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";

import { getEnv } from "../config/env";
import { logger } from "../observability/logger";
import * as schema from "./schema";

export type Schema = typeof schema;

/**
 * The query-builder type used throughout the repositories.
 *
 * The three drivers expose the same builder surface but are distinct nominal
 * types, and a union of them makes every method call resolve to an unusable
 * intersection of overloads. `NodePgDatabase` is taken as the canonical shape
 * and the others are cast to it at construction — the SQL each produces is
 * identical, which is the whole point of using one ORM.
 */
export type Database = NodePgDatabase<Schema>;

interface Holder {
  db?: Database;
  /** Kept so tests and scripts can close cleanly. */
  close?: () => Promise<void>;
  driver?: string;
}

const holder: Holder = ((globalThis as Record<string, unknown>).__niramoyDb as Holder) ??
  ((globalThis as Record<string, unknown>).__niramoyDb = {} as Holder);

function build(): { db: Database; close: () => Promise<void>; driver: string } {
  const env = getEnv();

  switch (env.databaseDriver) {
    case "neon": {
      // Lazy require: the driver is only pulled in when it is the one in use.
      const { neon } = require("@neondatabase/serverless") as typeof import("@neondatabase/serverless");
      const sql = neon(env.databaseUrl as string);
      return {
        db: drizzleNeon(sql, { schema, casing: "snake_case" }) as unknown as Database,
        close: async () => {},
        driver: "neon",
      };
    }

    case "pg": {
      const { Pool } = require("pg") as typeof import("pg");
      const pool = new Pool({
        connectionString: env.databaseUrl,
        // Serverless invocations are short and concurrent; a large per-instance
        // pool multiplies across instances and exhausts the server. Keep it small
        // and let the platform's pooler do the multiplexing.
        max: env.isProd ? 3 : 10,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 8_000,
        allowExitOnIdle: true,
      });
      pool.on("error", (err) => logger.error("postgres pool error", { err }));
      return {
        db: drizzleNode(pool, { schema, casing: "snake_case" }),
        close: () => pool.end(),
        driver: "pg",
      };
    }

    case "pglite":
    default: {
      const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
      // btree_gist is not built into PGlite and must be loaded explicitly. It is
      // what makes the appointment overlap EXCLUDE constraint possible, so the
      // in-process database enforces exactly the same integrity as a real server.
      const { btree_gist } = require("@electric-sql/pglite/contrib/btree_gist") as {
        btree_gist: unknown;
      };
      // A file-backed instance in development so data survives a restart;
      // memory in test so every run starts clean.
      const dataDir = env.isTest ? "memory://" : ".pglite";
      const client = new PGlite(dataDir, { extensions: { btree_gist } } as never);
      logger.warn("using the in-process PGlite database", {
        dataDir,
        hint: "Set DATABASE_URL to use a real PostgreSQL server.",
      });
      return {
        db: drizzlePglite(client, { schema, casing: "snake_case" }) as unknown as Database,
        close: () => client.close(),
        driver: "pglite",
      };
    }
  }
}

/** The shared database handle. */
export function getDb(): Database {
  if (!holder.db) {
    const built = build();
    holder.db = built.db;
    holder.close = built.close;
    holder.driver = built.driver;
  }
  return holder.db;
}

export function getDriver(): string {
  getDb();
  return holder.driver ?? "unknown";
}

/** Close and forget the handle. For scripts and test teardown only. */
export async function closeDb(): Promise<void> {
  await holder.close?.();
  holder.db = undefined;
  holder.close = undefined;
  holder.driver = undefined;
}

export { schema };
