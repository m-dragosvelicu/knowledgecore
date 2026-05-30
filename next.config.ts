import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
