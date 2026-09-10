/** @type {import('next').NextConfig} */
const nextConfig = {
  // This checkout sits under a directory that also contains a lockfile, which
  // makes Next infer the wrong workspace root. Pin it.
  outputFileTracingRoot: import.meta.dirname,

  // The Postgres drivers are server-only and must not be traced into the client
  // or the edge bundle.
  // nodemailer is server-only too, and bundling it drags a large dependency
  // tree into the function output for no benefit.
  serverExternalPackages: ["pg", "@electric-sql/pglite", "@neondatabase/serverless", "nodemailer"],

  eslint: { dirs: ["app", "lib", "scripts", "test"] },
};

export default nextConfig;
