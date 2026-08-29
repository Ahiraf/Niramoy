/**
 * Niramoy — environment configuration
 * -----------------------------------------------------------------------------
 * One parse, one source of truth. Nothing else in the codebase reads
 * `process.env` directly; importing this module gives you a validated, typed
 * object instead.
 *
 * Two properties are deliberately preserved from the prototype:
 *
 *   1. The app runs with ZERO environment variables set. Every optional
 *      provider falls back to a safe mock, and the database falls back to an
 *      in-process one in development. That is what makes the project reviewable
 *      without infrastructure.
 *
 *   2. Production is strict. When APP_ENV=production, the variables that must
 *      not be defaulted (SESSION_SECRET, DATABASE_URL, CRON_SECRET, the admin
 *      invite code) are required, and startup fails loudly rather than running
 *      on a guessable secret.
 */

import { z } from "zod";

const APP_ENVS = ["development", "test", "production"] as const;

/** A secret that must be unguessable in production. */
const secret = z.string().min(32, "must be at least 32 characters");

const schema = z
  .object({
    APP_ENV: z.enum(APP_ENVS).default("development"),
    APP_URL: z.string().url().default("http://localhost:3000"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    /* ---- Database ---------------------------------------------------------- */
    // Accepts the Vercel Postgres names too, so an existing Vercel project's
    // env block works unchanged. DATABASE_URL wins when several are present.
    DATABASE_URL: z.string().min(1).optional(),
    POSTGRES_URL: z.string().min(1).optional(),
    POSTGRES_URL_NON_POOLING: z.string().min(1).optional(),
    DATABASE_URL_TEST: z.string().min(1).optional(),
    /** Force the driver rather than inferring it from the connection string. */
    DATABASE_DRIVER: z.enum(["neon", "pg", "pglite"]).optional(),

    /* ---- Auth -------------------------------------------------------------- */
    SESSION_SECRET: z.string().optional(),
    NIRAMOY_ADMIN_CODE: z.string().optional(),

    /* ---- Providers (all optional; each falls back to a mock) --------------- */
    AI_PROVIDER: z.enum(["rules", "openai-compatible"]).optional(),
    AI_API_KEY: z.string().optional(),
    AI_BASE_URL: z.string().url().optional(),
    AI_MODEL: z.string().optional(),

    EMAIL_PROVIDER: z.enum(["console", "resend"]).optional(),
    EMAIL_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),

    VIDEO_PROVIDER: z.enum(["demo", "daily", "jitsi"]).optional(),
    VIDEO_API_KEY: z.string().optional(),
    VIDEO_API_SECRET: z.string().optional(),
    VIDEO_DOMAIN: z.string().optional(),

    PAYMENT_PROVIDER: z.enum(["mock", "bkash", "nagad"]).optional(),
    PAYMENT_API_KEY: z.string().optional(),
    PAYMENT_API_SECRET: z.string().optional(),
    PAYMENT_WEBHOOK_SECRET: z.string().optional(),

    /** A real BM&DC data-sharing endpoint. Unset => admin verifies by hand. */
    BMDC_API_URL: z.string().url().optional(),

    RATE_LIMIT_STORE_URL: z.string().optional(),
    RATE_LIMIT_STORE_TOKEN: z.string().optional(),

    CRON_SECRET: z.string().optional(),

    /* ---- Clinical / locale ------------------------------------------------- */
    /** IANA zone. Never a hardcoded UTC offset — see docs/ARCHITECTURE.md. */
    DISPLAY_TIMEZONE: z.string().default("Asia/Dhaka"),
    EMERGENCY_NUMBER: z.string().default("999"),
    /** Seeded synthetic profiles are refused in production. */
    // Left as the raw string: an `.optional().transform(v => v === "true")`
    // would collapse "unset" into `false`, defeating the `?? !isProd` default
    // applied below.
    ALLOW_DEMO_PROFILES: z.enum(["true", "false"]).optional(),
  })
  .transform((raw) => {
    const isProd = raw.APP_ENV === "production";
    const isTest = raw.APP_ENV === "test";

    const databaseUrl = raw.DATABASE_URL ?? raw.POSTGRES_URL ?? (isTest ? raw.DATABASE_URL_TEST : undefined);

    return {
      ...raw,
      isProd,
      isTest,
      /**
       * Whether APP_URL was actually set, as opposed to falling back to the
       * localhost default above. The CSRF origin check needs to tell those
       * apart: a deployer who names their origin gets it enforced strictly,
       * and everyone else gets the origin the request actually arrived on.
       */
      appUrlConfigured: Boolean(process.env.APP_URL),
      isDev: raw.APP_ENV === "development",
      databaseUrl,
      /** Non-pooled URL for migrations and long transactions. */
      databaseUrlDirect: raw.POSTGRES_URL_NON_POOLING ?? databaseUrl,
      /** In dev with no DATABASE_URL we run an in-process Postgres (PGlite). */
      databaseDriver: raw.DATABASE_DRIVER ?? inferDriver(databaseUrl),
      sessionSecret: raw.SESSION_SECRET ?? (isProd ? undefined : DEV_SESSION_SECRET),
      adminInviteCode: raw.NIRAMOY_ADMIN_CODE ?? (isProd ? undefined : "NIRAMOY-ADMIN"),
      cronSecret: raw.CRON_SECRET ?? (isProd ? undefined : "dev-cron-secret"),
      /** Demo profiles are on everywhere except production, unless overridden. */
      allowDemoProfiles:
        raw.ALLOW_DEMO_PROFILES === undefined ? !isProd : raw.ALLOW_DEMO_PROFILES === "true",
      /** No key means the rule engine. This is a safety property, not a default. */
      aiProvider: raw.AI_PROVIDER ?? (raw.AI_API_KEY && raw.AI_BASE_URL ? "openai-compatible" : "rules"),
      emailProvider: raw.EMAIL_PROVIDER ?? (raw.EMAIL_API_KEY ? "resend" : "console"),
      videoProvider: raw.VIDEO_PROVIDER ?? (raw.VIDEO_API_KEY ? "daily" : "demo"),
      paymentProvider: raw.PAYMENT_PROVIDER ?? "mock",
    };
  })
  .superRefine((cfg, ctx) => {
    if (!cfg.isProd) return;

    // Production must not run on a defaulted secret.
    const required: Array<[string, unknown]> = [
      ["DATABASE_URL", cfg.databaseUrl],
      ["SESSION_SECRET", cfg.sessionSecret],
      ["NIRAMOY_ADMIN_CODE", cfg.adminInviteCode],
      ["CRON_SECRET", cfg.cronSecret],
    ];
    for (const [name, value] of required) {
      if (!value) {
        ctx.addIssue({ code: "custom", path: [name], message: `${name} is required when APP_ENV=production` });
      }
    }

    for (const [name, value] of [
      ["SESSION_SECRET", cfg.SESSION_SECRET],
      ["CRON_SECRET", cfg.CRON_SECRET],
    ] as const) {
      if (value && !secret.safeParse(value).success) {
        ctx.addIssue({ code: "custom", path: [name], message: `${name} must be at least 32 characters` });
      }
    }

    if (cfg.databaseDriver === "pglite") {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "PGlite is a development/test database and must not be used in production",
      });
    }
  });

/**
 * A fixed development secret. Deliberately obvious: if this string ever shows up
 * in a production incident, the cause is unambiguous. Production refuses to boot
 * without a real SESSION_SECRET, so this can never silently ship.
 */
const DEV_SESSION_SECRET = "niramoy-development-only-session-secret-do-not-use-in-production";

function inferDriver(url: string | undefined): "neon" | "pg" | "pglite" {
  if (!url) return "pglite";
  return /neon\.tech|vercel-storage\.com/.test(url) ? "neon" : "pg";
}

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/**
 * Parse and cache the environment. Throws a readable aggregate error listing
 * every problem at once rather than failing one variable at a time.
 */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: forget the cached parse so a test can change process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}

export const env = new Proxy({} as Env, {
  get: (_t, prop: string) => getEnv()[prop as keyof Env],
  has: (_t, prop: string) => prop in getEnv(),
  ownKeys: () => Reflect.ownKeys(getEnv()),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});
