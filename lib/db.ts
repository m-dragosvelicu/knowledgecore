import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Prisma singleton with hot-reload safety.
 *
 * Why the global: Next.js dev mode tears down and re-evaluates module instances on every
 * file change. Without caching the client on `globalThis`, each HMR cycle would leak a
 * new `PrismaClient` and exhaust Postgres connections within minutes. The guard is dev-
 * only because production (Vercel / standalone) gives each lambda a fresh module graph.
 *
 * Log levels are deliberately conservative:
 *   - dev: `query`, `error`, `warn` for visibility while developing.
 *   - prod: `error`, `warn` only — `query` logs would flood Vercel and leak prompt-
 *     adjacent data to logs.
 */

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const logLevels: Prisma.LogLevel[] =
  process.env.NODE_ENV === "production"
    ? ["error", "warn"]
    : ["query", "error", "warn"];

function createPrismaClient(): PrismaClient {
  return new PrismaClient({ log: logLevels });
}

export const prisma = globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
