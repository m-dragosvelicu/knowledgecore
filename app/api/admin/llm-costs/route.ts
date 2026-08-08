import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth-guards";

/**
 * Internal ops route: aggregates LlmCall telemetry (cost + tokens) over a date
 * range, grouped by purpose / model / day / journey / user. Backs
 * /admin/llm-costs. Cost-sensitive (reveals per-user and per-journey spend),
 * so gated behind currentAdminSession() — a fail-closed ADMIN_EMAILS allowlist
 * (see lib/auth-guards.ts; no admin/role column exists in the schema).
 */

export const runtime = "nodejs";

const DEFAULT_RANGE_DAYS = 30;
// Caps the per-journey / per-user breakdown rows so one very long range on a
// large dataset can't return an unbounded payload. Sorted by cost desc first,
// so the cap only ever drops the smallest spenders.
const BREAKDOWN_LIMIT = 200;

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a `from`/`to` query param into a Date. A bare date-only string
 * ("YYYY-MM-DD", what LlmCostsDashboard.tsx's <input type="date"> always
 * sends) is ambiguous about time-of-day: `new Date("YYYY-MM-DD")` parses to
 * 00:00:00.000 UTC. For `from` that is already the correct start-of-range
 * bound. For `to` it is WRONG as an inclusive upper bound (`lte: to`) —
 * midnight-UTC-of-that-day excludes virtually the entire selected end day, a
 * real bug (QA 2026-08-08): fix by resolving a date-only `to` to the END of
 * that day (23:59:59.999 UTC) instead. A full ISO datetime string (has a "T")
 * is never date-only and is always used verbatim, for both `from` and `to`.
 */
function parseBoundary(raw: string, endOfDayIfDateOnly: boolean): Date | null {
  const trimmed = raw.trim();
  const iso = DATE_ONLY_RE.test(trimmed)
    ? `${trimmed}T${endOfDayIfDateOnly ? "23:59:59.999" : "00:00:00.000"}Z`
    : trimmed;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type LlmCostTotals = {
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  callCount: number;
  successCount: number;
  failureCount: number;
};

export type LlmCostByPurpose = {
  purpose: string;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
};

export type LlmCostByModel = {
  model: string;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
};

export type LlmCostByDay = {
  day: string; // YYYY-MM-DD (UTC)
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
};

export type LlmCostByJourney = {
  intentId: string;
  subject: string | null;
  userId: string | null;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
};

export type LlmCostByUser = {
  userId: string;
  email: string | null;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
};

export type LlmCostsResponse = {
  range: { from: string; to: string };
  totals: LlmCostTotals;
  byPurpose: LlmCostByPurpose[];
  byModel: LlmCostByModel[];
  byDay: LlmCostByDay[];
  byJourney: LlmCostByJourney[];
  byUser: LlmCostByUser[];
  // True when byJourney/byUser were truncated to BREAKDOWN_LIMIT rows (sorted
  // by cost desc, so only the smallest spenders would be missing).
  journeyBreakdownTruncated: boolean;
  userBreakdownTruncated: boolean;
};

function sum0(n: number | null | undefined): number {
  return n ?? 0;
}

export async function GET(request: Request): Promise<Response> {
  const session = await currentAdminSession();
  if (!session) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid `from`/`to` query params" },
      { status: 400 },
    );
  }

  // `to` gets the end-of-day treatment when date-only; `from` keeps the
  // natural start-of-day midnight when date-only (see parseBoundary).
  const to = parsed.data.to ? parseBoundary(parsed.data.to, true) : new Date();
  if (to === null) {
    return NextResponse.json({ error: "invalid `to` query param" }, { status: 400 });
  }
  const from = parsed.data.from
    ? parseBoundary(parsed.data.from, false)
    : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  if (from === null) {
    return NextResponse.json({ error: "invalid `from` query param" }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json(
      { error: "`from` must be before `to`" },
      { status: 400 },
    );
  }

  const where: Prisma.LlmCallWhereInput = {
    createdAt: { gte: from, lte: to },
  };

  const [totalsAgg, successGroups, byPurposeRaw, byModelRaw, byDayRaw] =
    await Promise.all([
      prisma.llmCall.aggregate({
        where,
        _sum: { costMicroUsd: true, inputTokens: true, outputTokens: true },
        _count: { _all: true },
      }),
      prisma.llmCall.groupBy({
        by: ["success"],
        where,
        _count: { _all: true },
      }),
      prisma.llmCall.groupBy({
        by: ["purpose"],
        where,
        _sum: { costMicroUsd: true, inputTokens: true, outputTokens: true },
        _count: { _all: true },
        orderBy: { _sum: { costMicroUsd: "desc" } },
      }),
      prisma.llmCall.groupBy({
        by: ["model"],
        where,
        _sum: { costMicroUsd: true, inputTokens: true, outputTokens: true },
        _count: { _all: true },
        orderBy: { _sum: { costMicroUsd: "desc" } },
      }),
      prisma.$queryRaw<
        Array<{
          day: Date;
          costMicroUsd: bigint | null;
          inputTokens: bigint | null;
          outputTokens: bigint | null;
          callCount: bigint;
        }>
      >(Prisma.sql`
        SELECT
          date_trunc('day', "createdAt") AS day,
          SUM("costMicroUsd")::bigint AS "costMicroUsd",
          SUM("inputTokens")::bigint AS "inputTokens",
          SUM("outputTokens")::bigint AS "outputTokens",
          COUNT(*)::bigint AS "callCount"
        FROM "LlmCall"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY 1
        ORDER BY 1 ASC
      `),
    ]);

  const successCount =
    successGroups.find((g) => g.success === true)?._count._all ?? 0;
  const failureCount =
    successGroups.find((g) => g.success === false)?._count._all ?? 0;

  const totals: LlmCostTotals = {
    costMicroUsd: sum0(totalsAgg._sum.costMicroUsd),
    inputTokens: sum0(totalsAgg._sum.inputTokens),
    outputTokens: sum0(totalsAgg._sum.outputTokens),
    totalTokens:
      sum0(totalsAgg._sum.inputTokens) + sum0(totalsAgg._sum.outputTokens),
    callCount: totalsAgg._count._all,
    successCount,
    failureCount,
  };

  const byPurpose: LlmCostByPurpose[] = byPurposeRaw.map((g) => ({
    purpose: g.purpose,
    costMicroUsd: sum0(g._sum.costMicroUsd),
    inputTokens: sum0(g._sum.inputTokens),
    outputTokens: sum0(g._sum.outputTokens),
    callCount: g._count._all,
  }));

  const byModel: LlmCostByModel[] = byModelRaw.map((g) => ({
    model: g.model,
    costMicroUsd: sum0(g._sum.costMicroUsd),
    inputTokens: sum0(g._sum.inputTokens),
    outputTokens: sum0(g._sum.outputTokens),
    callCount: g._count._all,
  }));

  const byDay: LlmCostByDay[] = byDayRaw.map((r) => ({
    day: r.day.toISOString().slice(0, 10),
    costMicroUsd: Number(r.costMicroUsd ?? 0n),
    inputTokens: Number(r.inputTokens ?? 0n),
    outputTokens: Number(r.outputTokens ?? 0n),
    callCount: Number(r.callCount),
  }));

  // --- Per-journey breakdown ---
  const journeyGroups = await prisma.llmCall.groupBy({
    by: ["intentId"],
    where: { ...where, intentId: { not: null } },
    _sum: { costMicroUsd: true, inputTokens: true, outputTokens: true },
    _count: { _all: true },
    orderBy: { _sum: { costMicroUsd: "desc" } },
    take: BREAKDOWN_LIMIT + 1,
  });
  const journeyBreakdownTruncated = journeyGroups.length > BREAKDOWN_LIMIT;
  const journeyRows = journeyGroups.slice(0, BREAKDOWN_LIMIT);
  const journeyIds = journeyRows
    .map((g) => g.intentId)
    .filter((id): id is string => id !== null);
  const intents = journeyIds.length
    ? await prisma.learningIntent.findMany({
        where: { id: { in: journeyIds } },
        select: { id: true, userId: true, subject: { select: { canonicalName: true } } },
      })
    : [];
  const intentById = new Map(intents.map((i) => [i.id, i]));

  const byJourney: LlmCostByJourney[] = journeyRows.map((g) => {
    const intentId = g.intentId as string;
    const intent = intentById.get(intentId);
    return {
      intentId,
      subject: intent?.subject?.canonicalName ?? null,
      userId: intent?.userId ?? null,
      costMicroUsd: sum0(g._sum.costMicroUsd),
      inputTokens: sum0(g._sum.inputTokens),
      outputTokens: sum0(g._sum.outputTokens),
      callCount: g._count._all,
    };
  });

  // --- Per-user breakdown ---
  const userGroups = await prisma.llmCall.groupBy({
    by: ["userId"],
    where: { ...where, userId: { not: null } },
    _sum: { costMicroUsd: true, inputTokens: true, outputTokens: true },
    _count: { _all: true },
    orderBy: { _sum: { costMicroUsd: "desc" } },
    take: BREAKDOWN_LIMIT + 1,
  });
  const userBreakdownTruncated = userGroups.length > BREAKDOWN_LIMIT;
  const userRows = userGroups.slice(0, BREAKDOWN_LIMIT);
  const userIds = userRows
    .map((g) => g.userId)
    .filter((id): id is string => id !== null);
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const byUser: LlmCostByUser[] = userRows.map((g) => {
    const userId = g.userId as string;
    return {
      userId,
      email: userById.get(userId)?.email ?? null,
      costMicroUsd: sum0(g._sum.costMicroUsd),
      inputTokens: sum0(g._sum.inputTokens),
      outputTokens: sum0(g._sum.outputTokens),
      callCount: g._count._all,
    };
  });

  const body: LlmCostsResponse = {
    range: { from: from.toISOString(), to: to.toISOString() },
    totals,
    byPurpose,
    byModel,
    byDay,
    byJourney,
    byUser,
    journeyBreakdownTruncated,
    userBreakdownTruncated,
  };

  return NextResponse.json(body);
}
