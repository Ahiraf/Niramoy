import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

/**
 * drizzle-kit only generates SQL here; it never runs against production.
 * Migrations are applied by `npm run db:migrate` (scripts/migrate.ts), which
 * uses the non-pooled connection string.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema/index.ts",
  out: "./lib/db/migrations",
  casing: "snake_case",
  dbCredentials: {
    url:
      process.env.POSTGRES_URL_NON_POOLING ??
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      "postgresql://localhost:5432/niramoy",
  },
  verbose: true,
  strict: true,
});
