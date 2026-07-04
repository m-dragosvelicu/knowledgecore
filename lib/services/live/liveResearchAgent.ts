/**
 * L2 — LiveResearchAgent: the live implementation of the ResearchAgent interface.
 *
 * Routing (ADR 9):
 *   introductory / intermediate -> web tier only (Tavily)
 *   advanced                    -> web tier first, then academic tier (OpenAlex)
 *   research-grade              -> academic tier (OpenAlex + Semantic Scholar)
 *
 * Retrieval pipeline per source:
 *   1. Tavily webSearch (web tier) OR OpenAlex/SemanticScholar (academic tier)
 *   2. For each hit, extract full text via Trafilatura sidecar; fall back to Jina.
 *   3. Chunk the extracted text into ~512-token paragraphs (character-budget approx).
 *   4. Assemble Source + Chunk objects conforming to lib/services/research.ts contracts.
 *
 * Graceful degradation (T04):
 *   - If a URL fails extraction, skip it (do not error the whole bundle).
 *   - If zero sources yield usable text, return an EMPTY bundle (sources: []).
 *     The BundleStore (researchBundle.ts) already handles empty bundles gracefully:
 *     it will mark the bundle ready with zero sources and the journey stays
 *     ungrounded (sourceIds: []), which is distinct from a key-missing failure.
 *   - A missing TAVILY_API_KEY is NOT degraded: it throws immediately (fail-fast),
 *     consistent with the live-only philosophy and T05.
 *
 * Closed-book semantics are PRESERVED: the agent assembles source material BEFORE
 * generation starts. The generator receives sourceIds from the persisted bundle and
 * cites them; it never opens the live web mid-lesson.
 */

import { createHash } from "node:crypto";
import type {
  Bundle,
  Chunk,
  GapQueries,
  ResearchAgent,
  ResearchProgressSink,
  Source,
} from "@/lib/services/research";
import { webSearch } from "@/lib/research/tavily";
import { searchWorks } from "@/lib/research/openalex";
import { searchPapers } from "@/lib/research/semanticScholar";
import { extract } from "@/lib/research/extract";
import { routeQueries } from "@/lib/research/intentRouter";
import type { RoutingDecision } from "@/lib/research/intentRouter";

// Approximate character budget per chunk (~512 tokens at ~4 chars/token).
const CHUNK_CHAR_BUDGET = 2_048;
// Maximum number of web hits to attempt extraction on.
const MAX_WEB_HITS = 8;
// Maximum academic works to process.
const MAX_ACADEMIC_WORKS = 5;
// Minimum text length for a source to be considered usable.
const MIN_TEXT_LENGTH = 200;

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Split raw text into paragraph-aware chunks with a character budget.
 * Prefers splitting on double-newlines (paragraph boundaries); falls back to
 * simple fixed-length windows when paragraphs are too short or too long.
 */
function chunkText(ref: string, text: string): Chunk[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: Chunk[] = [];
  let current = "";
  let ordinal = 0;

  const flush = (t: string): void => {
    const trimmed = t.trim();
    if (trimmed.length < 50) return;
    const contentHash = sha256(`${ref}:${ordinal}:${trimmed}`);
    chunks.push({ contentHash, ordinal, text: trimmed });
    ordinal++;
    current = "";
  };

  for (const para of paragraphs) {
    if (para.length > CHUNK_CHAR_BUDGET) {
      // Long paragraph: flush any accumulated text, then split the paragraph.
      if (current) flush(current);
      for (let i = 0; i < para.length; i += CHUNK_CHAR_BUDGET) {
        flush(para.slice(i, i + CHUNK_CHAR_BUDGET));
      }
    } else if (current.length + para.length + 2 > CHUNK_CHAR_BUDGET) {
      flush(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current) flush(current);
  return chunks;
}

/** Assemble a Source from a Tavily hit + extracted text. Returns null if unusable. */
async function sourceFromWebHit(
  hit: { url: string; title: string; content: string; score: number },
  ordinalRef: number,
  topicLabel: string,
): Promise<Source | null> {
  const ref = `web-${ordinalRef}`;
  const ext = await extract(hit.url);

  const rawText = ext.ok && ext.text.length >= MIN_TEXT_LENGTH ? ext.text : null;
  if (!rawText) return null;

  const canonicalUrl = hit.url;
  const dedupKey = `url:${canonicalUrl}`;
  const title = ext.title ?? hit.title;
  const publishedYear = ext.date ? parseYear(ext.date) : null;
  const authors = ext.author ? [{ name: ext.author }] : [];

  return {
    ref,
    kind: "web",
    dedupKey,
    doi: null,
    canonicalUrl,
    title,
    authors,
    venue: ext.sitename ?? null,
    publishedYear,
    rawText,
    scopeNote: `Web source for "${topicLabel}" (Tavily score ${hit.score.toFixed(2)})`,
    chunks: chunkText(ref, rawText),
  };
}

/** Assemble a Source from an OpenAlex work. Uses openAccessUrl for extraction. */
async function sourceFromOpenAlexWork(
  work: {
    id: string;
    doi: string | null;
    title: string;
    abstract: string | null;
    publicationYear: number | null;
    citedByCount: number;
    authors: Array<{ name: string }>;
    openAccessUrl: string | null;
  },
  ordinalRef: number,
  topicLabel: string,
): Promise<Source | null> {
  const ref = `oa-${ordinalRef}`;

  let rawText: string | null = null;

  // Try full-text extraction from open-access URL.
  if (work.openAccessUrl) {
    const ext = await extract(work.openAccessUrl);
    if (ext.ok && ext.text.length >= MIN_TEXT_LENGTH) rawText = ext.text;
  }

  // Fall back to abstract if we have it and no full text.
  if (!rawText && work.abstract && work.abstract.length >= MIN_TEXT_LENGTH) {
    rawText = work.abstract;
  }

  if (!rawText) return null;

  const doi = work.doi ?? null;
  const dedupKey = doi ? `doi:${doi}` : `url:${work.openAccessUrl ?? work.id}`;
  const canonicalUrl = doi ? `https://doi.org/${doi}` : work.openAccessUrl ?? null;

  return {
    ref,
    kind: "academic",
    dedupKey,
    doi,
    canonicalUrl,
    title: work.title,
    authors: work.authors.map((a) => ({ name: a.name })),
    venue: null,
    publishedYear: work.publicationYear,
    rawText,
    scopeNote: `Academic source for "${topicLabel}" (OpenAlex, cited ${work.citedByCount}x)`,
    chunks: chunkText(ref, rawText),
  };
}

/** Assemble a Source from a Semantic Scholar paper. */
async function sourceFromSemanticPaper(
  paper: {
    paperId: string;
    title: string;
    abstract: string | null;
    year: number | null;
    citationCount: number | null;
    authors: Array<{ name: string }>;
    url: string | null;
    openAccessPdf: { url: string } | null;
  },
  ordinalRef: number,
  topicLabel: string,
): Promise<Source | null> {
  const ref = `ss-${ordinalRef}`;

  let rawText: string | null = null;

  if (paper.openAccessPdf?.url) {
    const ext = await extract(paper.openAccessPdf.url);
    if (ext.ok && ext.text.length >= MIN_TEXT_LENGTH) rawText = ext.text;
  }

  if (!rawText && paper.abstract && paper.abstract.length >= MIN_TEXT_LENGTH) {
    rawText = paper.abstract;
  }

  if (!rawText) return null;

  const canonicalUrl = paper.url ?? paper.openAccessPdf?.url ?? null;
  const dedupKey = `ss:${paper.paperId}`;

  return {
    ref,
    kind: "academic",
    dedupKey,
    doi: null,
    canonicalUrl,
    title: paper.title,
    authors: paper.authors.map((a) => ({ name: a.name })),
    venue: null,
    publishedYear: paper.year,
    rawText,
    scopeNote: `Academic source for "${topicLabel}" (Semantic Scholar, cited ${paper.citationCount ?? 0}x)`,
    chunks: chunkText(ref, rawText),
  };
}

function parseYear(dateStr: string): number | null {
  const m = dateStr.match(/\b(19|20)\d{2}\b/);
  if (!m) return null;
  const y = parseInt(m[0], 10);
  return Number.isNaN(y) ? null : y;
}

/** Advisory-only: a throwing/rejecting sink must never abort research. */
async function safeEmit(
  onProgress: ResearchProgressSink | undefined,
  event: Parameters<ResearchProgressSink>[0],
): Promise<void> {
  if (!onProgress) return;
  try {
    await onProgress(event);
  } catch {
    // Progress is advisory; never let a sink failure abort research.
  }
}

async function fetchWebSources(
  query: string,
  topicLabel: string,
  onProgress?: ResearchProgressSink,
): Promise<Source[]> {
  const hits = await webSearch(query, {
    maxResults: MAX_WEB_HITS,
    searchDepth: "basic",
    includeRawContent: false,
  });

  const sources: Source[] = [];
  let ordinal = 0;
  if (hits.length > 0) {
    await safeEmit(onProgress, { phase: "reading", done: 0, total: hits.length });
  }
  for (let i = 0; i < hits.length; i++) {
    const src = await sourceFromWebHit(hits[i], ordinal++, topicLabel);
    if (src) sources.push(src);
    await safeEmit(onProgress, { phase: "reading", done: i + 1, total: hits.length });
  }
  return sources;
}

async function fetchAcademicSources(
  query: string,
  topicLabel: string,
  onProgress?: ResearchProgressSink,
): Promise<Source[]> {
  const sources: Source[] = [];

  // OpenAlex primary.
  try {
    const works = await searchWorks(query, {
      perPage: MAX_ACADEMIC_WORKS,
      openAccessOnly: true,
    });
    const toProcess = works.slice(0, MAX_ACADEMIC_WORKS);
    let ordinal = 0;
    if (toProcess.length > 0) {
      await safeEmit(onProgress, { phase: "reading", done: 0, total: toProcess.length });
    }
    for (let i = 0; i < toProcess.length; i++) {
      const src = await sourceFromOpenAlexWork(toProcess[i], ordinal++, topicLabel);
      if (src) sources.push(src);
      await safeEmit(onProgress, { phase: "reading", done: i + 1, total: toProcess.length });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[live-research-agent] OpenAlex search failed: ${(err as Error).message}`);
  }

  // Semantic Scholar expansion (if OpenAlex returned few results).
  if (sources.length < 2) {
    try {
      const papers = await searchPapers(query, { limit: MAX_ACADEMIC_WORKS });
      const toProcess = papers.slice(0, MAX_ACADEMIC_WORKS);
      let ordinal = sources.length;
      for (let i = 0; i < toProcess.length; i++) {
        const src = await sourceFromSemanticPaper(toProcess[i], ordinal++, topicLabel);
        if (src) sources.push(src);
        await safeEmit(onProgress, { phase: "reading", done: i + 1, total: toProcess.length });
        if (sources.length >= MAX_ACADEMIC_WORKS) break;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[live-research-agent] Semantic Scholar search failed: ${(err as Error).message}`);
    }
  }

  return sources;
}

export class LiveResearchAgent implements ResearchAgent {
  async research(
    topicKey: string,
    topicLabel: string,
    goalpostQueries: string[],
    onProgress?: ResearchProgressSink,
  ): Promise<Bundle> {
    // Fail fast if Tavily key is absent (T05: required for web tier).
    if (!process.env.TAVILY_API_KEY) {
      throw new Error(
        "TAVILY_API_KEY is required: the live Research Agent cannot run without it. " +
          "Set TAVILY_API_KEY in .env locally and in the Vercel project env for preview/production.",
      );
    }

    await safeEmit(onProgress, { phase: "searching" });

    const primaryQuery =
      goalpostQueries.length > 0 ? goalpostQueries.join(" ") : topicLabel;

    const decision: RoutingDecision = routeQueries(topicLabel, goalpostQueries);

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "live_research_agent.routing",
        topicKey,
        topicLabel,
        depth: decision.depth,
        tier: decision.tier,
        reason: decision.reason,
      }),
    );

    let sources: Source[] = [];

    try {
      if (decision.tier === "web" || decision.tier === "both") {
        const webSources = await fetchWebSources(primaryQuery, topicLabel, onProgress);
        sources.push(...webSources);
      }

      if (decision.tier === "academic" || decision.tier === "both") {
        const academicSources = await fetchAcademicSources(primaryQuery, topicLabel, onProgress);
        sources.push(...academicSources);
      }
    } catch (err) {
      // Non-key failures (network timeouts, unexpected 5xx) are logged and
      // degrade gracefully: the bundle returns whatever was collected so far,
      // which may be zero sources (T04).
      // eslint-disable-next-line no-console
      console.warn(
        `[live-research-agent] retrieval error for "${topicLabel}": ${(err as Error).message}`,
      );
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "live_research_agent.bundle_assembled",
        topicKey,
        topicLabel,
        sourceCount: sources.length,
        tier: decision.tier,
      }),
    );

    return { topicKey, topicLabel, sources };
  }

  async amend(bundleId: string, _gapQueries: GapQueries): Promise<Bundle> {
    // Amend (targeted gap-fill) is a later-phase concern (S04). For now return
    // an empty bundle so the contract type-checks end to end without error.
    return { topicKey: bundleId, topicLabel: `Amendment for ${bundleId}`, sources: [] };
  }
}
