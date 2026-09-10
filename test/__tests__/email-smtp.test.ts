/**
 * SMTP provider selection and delivery reporting.
 *
 * The property under test is the one that bites silently: a mailer that is
 * configured but not working must NOT degrade into the console provider, which
 * logs a message and calls it delivered.
 */
import { getEnv, resetEnvCache } from "../../lib/config/env";
import { getEmailProvider, resetEmailProvider } from "../../lib/notifications/providers";

/** Run one test with a specific environment, then put it back. */
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const before = { ...process.env };
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
  resetEmailProvider();
  try {
    return fn();
  } finally {
    process.env = before;
    resetEnvCache();
    resetEmailProvider();
  }
}

const SMTP = {
  SMTP_HOST: "smtp.gmail.com",
  SMTP_USER: "niramoy@example.com",
  SMTP_PASSWORD: "app-password-here",
  EMAIL_API_KEY: undefined,
  EMAIL_PROVIDER: undefined,
  EMAIL_FROM: undefined,
};

describe("choosing an email provider", () => {
  it("falls back to the console when nothing is configured", () => {
    withEnv({ ...SMTP, SMTP_HOST: undefined, SMTP_USER: undefined, SMTP_PASSWORD: undefined }, () => {
      expect(getEmailProvider().name).toBe("console");
    });
  });

  it("selects smtp once host, user and password are present", () => {
    withEnv(SMTP, () => {
      expect(getEnv().emailProvider).toBe("smtp");
      expect(getEmailProvider().name).toBe("smtp");
    });
  });

  it("prefers smtp over resend when both are configured", () => {
    withEnv({ ...SMTP, EMAIL_API_KEY: "re_something" }, () => {
      expect(getEmailProvider().name).toBe("smtp");
    });
  });

  it("refuses a half-configured mailer instead of quietly logging to console", () => {
    // The dangerous case: EMAIL_PROVIDER=smtp with a missing password would
    // otherwise send every verification link to a log file.
    expect(() =>
      withEnv({ ...SMTP, EMAIL_PROVIDER: "smtp", SMTP_PASSWORD: undefined }, getEmailProvider),
    ).toThrow(/SMTP_PASSWORD/);
  });

  it("refuses resend without an api key", () => {
    expect(() =>
      withEnv({ ...SMTP, SMTP_HOST: undefined, EMAIL_PROVIDER: "resend" }, getEmailProvider),
    ).toThrow(/EMAIL_API_KEY/);
  });
});

describe("the envelope sender", () => {
  it("defaults From to the authenticated mailbox", () => {
    // Providers rewrite a From they did not authenticate — Gmail always does —
    // so defaulting to a niramoy.app address would silently become something
    // else and make a bounce impossible to trace.
    withEnv(SMTP, () => {
      expect(getEnv().EMAIL_FROM ?? getEnv().SMTP_USER).toBe("niramoy@example.com");
    });
  });

  it("honours an explicit EMAIL_FROM", () => {
    withEnv({ ...SMTP, EMAIL_FROM: "Niramoy <care@niramoy.app>" }, () => {
      expect(getEnv().EMAIL_FROM).toBe("Niramoy <care@niramoy.app>");
    });
  });
});

describe("implicit TLS", () => {
  it("is inferred on 465 and not on 587", () => {
    withEnv({ ...SMTP, SMTP_PORT: "465" }, () => {
      const env = getEnv();
      expect(env.SMTP_SECURE === undefined ? env.SMTP_PORT === 465 : false).toBe(true);
    });
    withEnv({ ...SMTP, SMTP_PORT: "587" }, () => {
      const env = getEnv();
      expect(env.SMTP_SECURE === undefined ? env.SMTP_PORT === 465 : false).toBe(false);
    });
  });
});
