import { NextResponse } from "next/server";
import { getCurrentSession, isAnonymousSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { withLlmTelemetryContext } from "@/lib/llm";
import {
  LEARNER_SEARCH_LIMIT,
  searchLibraryForLearner,
  type LearnerSearchPassage,
} from "@/lib/library/learnerSearch";

export const runtime = "nodejs";

/** Hard cap so a hostile/typo limit can never fan out an unbounded Qdrant query. */
const MAX_LIMIT = 20;

export type LibrarySearchResponse = {
  query: string;
  scopedSourceCount: number;
  passages: LearnerSearchPassage[];
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ journeyId: string }> },
): Promise<Response> {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Library search is a learning surface (goalpost onward). Guests have no
  // goalposts and no bundles, so mirror the real-user gate used by sources.
  if (isAnonymousSession(session)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { journeyId } = await params;

  const intent = await prisma.learningIntent.findUnique({
    where: { id: journeyId },
    select: { userId: true },
  });
  if (!intent) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (intent.userId !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { query, limit, sourceKind } = parseBody(body);
  if (query === null) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  // Cost telemetry (2026-08-08 cost-gap close): attribute the query-embed
  // LlmCall row this triggers (searchLibraryForLearner -> embedPassages
  // purpose=embed_query) to this user/journey via the ambient context, same
  // as every other LLM-touching route/action.
  const result = await withLlmTelemetryContext(
    { userId: session.user.id, intentId: journeyId },
    () => searchLibraryForLearner(journeyId, query, { limit, sourceKind }),
  );
  return NextResponse.json(result satisfies LibrarySearchResponse);
}

function parseBody(body: unknown): {
  query: string | null;
  limit: number | undefined;
  sourceKind: "academic" | "web" | undefined;
} {
  const b = (body ?? {}) as Record<string, unknown>;
  const query =
    typeof b.query === "string" && b.query.trim().length > 0 ? b.query : null;

  let limit: number | undefined;
  if (typeof b.limit === "number" && Number.isFinite(b.limit)) {
    limit = Math.min(Math.max(1, Math.floor(b.limit)), MAX_LIMIT);
  }
  if (limit === undefined) limit = LEARNER_SEARCH_LIMIT;

  const sourceKind =
    b.sourceKind === "academic" || b.sourceKind === "web" ? b.sourceKind : undefined;

  return { query, limit, sourceKind };
}
