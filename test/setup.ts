/**
 * Jest setup. Loads .env.test if present, then pins the values every test relies
 * on. Nothing here may reach a real external provider: the whole suite runs
 * against the in-process database and the mock provider implementations.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.test", quiet: true });

process.env.APP_ENV ??= "test";
// NODE_ENV is declared readonly on ProcessEnv; assign through the index.
(process.env as Record<string, string | undefined>).NODE_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.NIRAMOY_ADMIN_CODE ??= "TEST-ADMIN-CODE";
process.env.APP_URL ??= "http://localhost:3000";

// A test must never accidentally call a provider.
delete process.env.AI_API_KEY;
delete process.env.AI_BASE_URL;
delete process.env.BMDC_API_URL;

jest.setTimeout(30_000);
