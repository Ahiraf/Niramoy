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

    /*
     * The failover chain, tried in this order: three Gemini keys, then OpenAI.
     *
     * Several keys because a free-tier quota is per key, and the daily one runs
     * out mid-afternoon rather than at a convenient moment. Nothing here is a
     * capacity strategy — it is what keeps the assistant answering when one
     * key stops. When every credential is exhausted the AI layer reports that
     * it has nothing, and each caller falls back to its deterministic result:
     * the triage rules, or the un-drafted summary. It never fails open.
     */
    GEMINI_API_KEY_1: z.string().optional(),
    GEMINI_API_KEY_2: z.string().optional(),
    GEMINI_API_KEY_3: z.string().optional(),
    GEMINI_MODEL: z.string().optional(),
    /** Google's OpenAI-compatible endpoint, so one request shape serves both. */
    GEMINI_BASE_URL: z.string().url().optional(),

    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().optional(),
    OPENAI_BASE_URL: z.string().url().optional(),

    EMAIL_PROVIDER: z.enum(["console", "resend"]).optional(),
    EMAIL_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),

    /**
     * SMS. `console` prints the message instead of sending it, which is what
     * makes sign-up reviewable without a gateway; `textbee` posts to a TextBee
     * account, which relays through an Android handset on a Bangladeshi SIM.
     */
    SMS_PROVIDER: z.enum(["console", "textbee"]).optional(),
    TEXTBEE_API_KEY: z.string().optional(),
    /** Optional: send from one specific handset rather than the account default. */
    TEXTBEE_DEVICE_ID: z.string().optional(),
    TEXTBEE_BASE_URL: z.string().url().optional(),

    /**
     * How wide a net one reminder run casts, in minutes. Must match how often
     * the job is actually scheduled: the run looks at appointments starting
     * REMINDER_LEAD_HOURS from now for exactly this long, so a job scheduled
     * daily with the hourly default would remind one hour's worth of patients
     * and silently skip the other twenty-three. Hourly cron → 60. Daily cron
     * (Vercel Hobby caps crons at once a day) → 1440.
     */
    REMINDER_WINDOW_MINUTES: z.coerce.number().int().min(15).max(10_080).optional(),

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
    /**
     * Deliberately run the credential-free public video room in production.
     *
     * Exists for one case: a deployed demonstration, where the two participants
     * are on different devices and there is no vendor account. It is off by
     * default and must be set by hand, because it swaps an access-controlled
     * room for an unlisted one — see docs/REGULATORY_ASSUMPTIONS.md before
     * using it in front of anyone who is not a marker.
     */
    ALLOW_PUBLIC_VIDEO_ROOM: z.enum(["true", "false"]).optional(),

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
      /** Never defaulted on. An unlisted room is a decision, not a fallback. */
      allowPublicVideoRoom: raw.ALLOW_PUBLIC_VIDEO_ROOM === "true",
      /** Demo profiles are on everywhere except production, unless overridden. */
      allowDemoProfiles:
        raw.ALLOW_DEMO_PROFILES === undefined ? !isProd : raw.ALLOW_DEMO_PROFILES === "true",
      /**
       * No key means the rule engine. This is a safety property, not a default:
       * the triage rules and the fallback summary are what runs when there is
       * no model, and they must be reachable without one.
       */
      aiProvider:
        raw.AI_PROVIDER ??
        (raw.GEMINI_API_KEY_1 ||
        raw.GEMINI_API_KEY_2 ||
        raw.GEMINI_API_KEY_3 ||
        raw.OPENAI_API_KEY ||
        (raw.AI_API_KEY && raw.AI_BASE_URL)
          ? "openai-compatible"
          : "rules"),
      emailProvider: raw.EMAIL_PROVIDER ?? (raw.EMAIL_API_KEY ? "resend" : "console"),
      /** A key means a gateway; no key means the code is printed, never sent. */
      smsProvider: raw.SMS_PROVIDER ?? (raw.TEXTBEE_API_KEY ? "textbee" : "console"),
      videoProvider: raw.VIDEO_PROVIDER ?? (raw.VIDEO_API_KEY ? "daily" : "demo"),
      paymentProvider: raw.PAYMENT_PROVIDER ?? "mock",
    };
  })
  .superRefine((cfg, ctx) => {
    /**
     * Asking for the gateway without a key is a misconfiguration in every
     * environment, not just production: the code would be generated, the
     * account would be told it was sent, and nothing would leave the building.
     */
    if (cfg.smsProvider === "textbee" && !cfg.TEXTBEE_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["TEXTBEE_API_KEY"],
        message: "SMS_PROVIDER=textbee requires TEXTBEE_API_KEY",
      });
    }

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

    /**
     * Jitsi without credentials falls back to a public meet.jit.si room, which
     * is unlisted but not access-controlled — anyone holding the URL can enter.
     * That is acceptable for a demonstration and not for a consultation.
     */
    if (
      cfg.videoProvider === "jitsi" &&
      !(cfg.VIDEO_API_KEY && cfg.VIDEO_API_SECRET) &&
      !cfg.allowPublicVideoRoom
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["VIDEO_API_SECRET"],
        message:
          "VIDEO_PROVIDER=jitsi in production requires VIDEO_API_KEY and VIDEO_API_SECRET, " +
          "because the credential-free public room is unlisted rather than " +
          "access-controlled. For a deployed demonstration, acknowledge that " +
          "explicitly with ALLOW_PUBLIC_VIDEO_ROOM=true.",
      });
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

  /**
   * An empty value means "not set", not "set to empty string".
   *
   * `.env.example` documents every variable as `NAME=` with nothing after it,
   * and the file says to copy it and fill in what you need — so a blank line is
   * the NORMAL state of most of these. Without this, copying the documented
   * template verbatim makes the application refuse to boot on `AI_PROVIDER=`,
   * because "" is not one of the enum's values. The error names the variable
   * the deployer deliberately left alone, which is the least useful place to
   * send them looking.
   */
  const present = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== ""),
  );

  const parsed = schema.safeParse(present);
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
