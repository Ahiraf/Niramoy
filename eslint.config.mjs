import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: ["node_modules/**", ".next/**", "out/**", "coverage/**", "lib/db/migrations/**"] },
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      // Server code must never leak secrets or PHI through stray console calls.
      // lib/observability/logger.ts is the sanctioned way to emit anything.
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Only repositories may touch the database client. See docs/ARCHITECTURE.md.
              group: ["**/lib/db/client", "**/lib/db/client.js", "@/lib/db/client"],
              message:
                "Only lib/repositories/* may import the database client. Route handlers and services go through a repository.",
            },
          ],
        },
      ],
    },
  },
  {
    // Repositories are the exception to the rule above — that is their job.
    // Services may open a transaction; the test harness must inject a database.
    files: ["lib/repositories/**", "lib/db/**", "lib/services/**", "lib/security/**",
            "lib/audit/**", "scripts/**", "test/**", "**/__tests__/**"],
    rules: { "no-restricted-imports": "off", "no-console": "off" },
  },
]

export default config;
