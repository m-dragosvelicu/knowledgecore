import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Prisma singleton with hot-reload safety. Next.js dev mode re-evaluates module
 * instances on every file change; without caching the client on `globalThis`,
 * each HMR cycle would leak a new PrismaClient and exhaust Postgres connections.
 * Dev-only guard — production gives each lambda a fresh module graph.
 *
 * Log levels: dev gets query/error/warn for visibility; prod is error/warn only
 * (query logs would flood Vercel and leak prompt-adjacent data).
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
