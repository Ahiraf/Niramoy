const nextJest = require("next/jest");

/**
 * next/jest gives us SWC-based transforms, so the suite runs TypeScript and the
 * remaining JavaScript modules side by side during the incremental migration.
 */
const createJestConfig = nextJest({ dir: "./" });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.[jt]s"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
  setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
  // Concurrency tests need a real Postgres server (PGlite is single-connection),
  // so they are opt-in via `npm run test:concurrency`.
  testPathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/.next/", "\\.concurrency\\.test\\."],
  collectCoverageFrom: ["lib/**/*.{js,ts}", "!lib/db/migrations/**", "!lib/data/**"],
};

module.exports = createJestConfig(config);
