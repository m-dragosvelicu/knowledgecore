import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Build output dir is env-driven so `next build` can target a separate
  // distDir (.next-build) and never overwrite the live `next dev --turbopack`
  // cache in `.next`. `next dev` leaves NEXT_DIST_DIR unset and stays on `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: {
    root: path.join(__dirname),
  },
  // better-auth is used only server-side (via the Prisma adapter). Keep it as a
  // runtime require instead of bundling, so webpack does not try to resolve its
  // optional adapters (e.g. @better-auth/kysely-adapter imports kysely symbols
  // the installed kysely version does not export, which breaks `next build`).
  serverExternalPackages: ["better-auth", "@better-auth/kysely-adapter", "kysely"],
};

export default nextConfig;
