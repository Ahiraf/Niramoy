/** @type {import('next').NextConfig} */
const nextConfig = {
  // This checkout sits under a directory that also contains a lockfile, which
  // makes Next infer the wrong workspace root. Pin it.
  outputFileTracingRoot: import.meta.dirname,

  // The Postgres drivers are server-only and must not be traced into the client
  // or the edge bundle.
  /*
   * Packages the bundler must NOT touch.
   *
   * `@node-rs/argon2` is the load-bearing one: it is a native addon, and a
   * `.node` binary cannot be bundled — it has to stay external so the real file
   * is traced into the function. Bundled, it resolves at build time and then
   * fails to load at runtime, which takes down every route that touches a
   * password. That failure is invisible locally, because `next dev` does not
   * bundle server code the same way: sign-up worked on a laptop and returned
   * 500 on Vercel, while the OTP step either side of it was fine because it
   * never hashes anything.
   *
   * The database drivers and nodemailer are here for the milder reason: they
   * are server-only and bundling them drags a large dependency tree into the
   * function output for no benefit.
   */
  serverExternalPackages: [
    "@node-rs/argon2",
    "pg",
    "@electric-sql/pglite",
    "@neondatabase/serverless",
    "nodemailer",
  ],

  eslint: { dirs: ["app", "lib", "scripts", "test"] },
};

export default nextConfig;
