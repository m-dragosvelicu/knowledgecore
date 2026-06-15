import { NextResponse } from "next/server";
import { getCurrentSession, isAnonymousSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

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

function buildAttribution(source: {
  kind: string;
  authors: unknown;
  venue: string | null;
  publishedYear: number | null;
  canonicalUrl: string | null;
}): string {
  if (source.kind === "academic") {
    const authors = Array.isArray(source.authors) ? (source.authors as string[]) : [];
    const authorPart =
      authors.length > 0
        ? authors.length > 2
          ? `${authors[0]} et al.`
          : authors.join(" & ")
        : null;
    const parts: string[] = [];
    if (authorPart) parts.push(authorPart);
    if (source.venue) parts.push(source.venue);
    if (source.publishedYear) parts.push(String(source.publishedYear));
    return parts.join(", ") || "Academic source";
  }
  // web: show the host name as attribution (enough for one-click link-out)
  if (source.canonicalUrl) {
    try {
      const host = new URL(source.canonicalUrl).hostname.replace(/^www\./, "");
      return host;
    } catch {
      // malformed URL — fall through
    }
  }
  return "Web source";
}

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
  const bundleLinks = await prisma.journeyBundle.findMany({
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
