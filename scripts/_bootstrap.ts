/**
 * Shared bootstrap for the CLI scripts (migrate, seed, reset).
 * Loads .env.local then .env, so a developer's local overrides win.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

process.env.APP_ENV ??= "development";
