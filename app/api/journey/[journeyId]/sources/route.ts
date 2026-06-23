import { NextResponse } from "next/server";
import { getCurrentSession, isAnonymousSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildAttribution } from "@/lib/journey/sourceAttribution";

export const runtime = "nodejs";

export type JourneySource = {
  id: string;
  kind: "academic" | "web";
  title: string;
  canonicalUrl: string | null;
  doi: string | null;
  attribution: string;
};

export type JourneySourcesResponse = {
  sources: JourneySource[];
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ journeyId: string }> },
): Promise<Response> {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Sources are a learning surface (not a pre-journey step). Guests have no
  // goalposts, so they can never have sources — mirror the real-user gate.
  if (isAnonymousSession(session)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { journeyId } = await params;

  // Ownership check: the intent must belong to the authenticated user.
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

  // Resolve all sources from READY bundles bound to this journey.
  const bundleLinks = await prisma.journeyBundleLink.findMany({
    where: { intentId: journeyId, bundle: { status: "ready" } },
    select: {
      bundle: {
        select: {
          sources: {
            select: {
              source: {
                select: {
                  id: true,
                  kind: true,
                  title: true,
                  canonicalUrl: true,
                  doi: true,
                  authors: true,
                  venue: true,
                  publishedYear: true,
                },
              },
            },
          },
        },
      },
    },
  });

  // Deduplicate by source id (a source can appear in multiple bundles).
  const seen = new Set<string>();
  const sources: JourneySource[] = [];
  for (const link of bundleLinks) {
    for (const bs of link.bundle.sources) {
      const src = bs.source;
      if (seen.has(src.id)) continue;
      seen.add(src.id);
      sources.push({
        id: src.id,
        kind: src.kind,
        title: src.title,
        canonicalUrl: src.canonicalUrl,
        doi: src.doi,
        attribution: buildAttribution(src),
      });
    }
  }

  return NextResponse.json({ sources } satisfies JourneySourcesResponse);
}
