/**
 * E01.S06 — Library learner search (query side / pattern (b) of the ratified
 * storage+search composition, decisions/2026-06-15-l2-library-storage-search-
 * composition.html).
 *
 * A learner inside a goalpost types a query; this service:
 *   1. embeds the query ONCE with the same Gemini model + framing used at ingest
 *      (gemini-embedding-001, dim 3072) via embedPassages — no second model,
 *   2. runs the single ratified payload-filtered cosine top-k primitive
 *      (searchPassages) against the shared kc_passages collection, scoped to the
 *      source ids reachable from the journey's bound READY bundles (the
 *      provenance scope = resolveJourneySourceIds), with a minimum-score floor,
 *   3. joins each hit back to Postgres by sourceId for citable metadata
 *      (title, attribution, link), so Qdrant stays a derived index, never truth.
 *
 * Ranking is pure cosine similarity (from Qdrant) with a deterministic tie-break
 * so identical scores order stably. Credibility re-rank is DEFERRED per ADR 9 and
 * is intentionally NOT built here (it slots in later as a post-retrieval step).
 */
import { prisma } from "@/lib/db";
import { resolveJourneySourceIds } from "@/lib/journey/researchBundle";
import { buildAttribution } from "@/lib/journey/sourceAttribution";
import { embedPassages } from "@/lib/research/embeddings/embed";
import { searchPassages, type PassageHit } from "@/lib/vector/kcPassages";

/** Default number of passages returned to the learner. */
export const LEARNER_SEARCH_LIMIT = 8;

/**
 * Minimum cosine similarity a hit must clear to be shown. Below this a passage is
 * not relevant enough to cite, so it is dropped rather than padding the result.
 * Cosine over Gemini embeddings: below ~0.5 hits are off-topic in practice; 0.55
 * is a conservative floor that keeps genuine matches and removes filler.
 */
export const LEARNER_SEARCH_SCORE_FLOOR = 0.55;

/** A pull-from-Qdrant multiplier so the floor + tie-break operate on a real pool. */
const OVERFETCH = 3;

export interface LearnerSearchPassage {
  chunkId: string;
  sourceId: string;
  score: number;
  preview: string;
  ordinal: number;
  /** Citable metadata joined from Postgres (Source row). */
  source: {
    id: string;
    kind: "academic" | "web";
    title: string;
    canonicalUrl: string | null;
    doi: string | null;
    attribution: string;
  };
}

export interface LearnerSearchResult {
  query: string;
  /** Number of in-scope sources searched (0 -> the journey is ungrounded). */
  scopedSourceCount: number;
  passages: LearnerSearchPassage[];
}

/**
 * Run a learner search against the journey's provenance scope.
 *
 * @param journeyId   the LearningIntent id (ownership is enforced by the caller)
 * @param query       the learner's free-text query
 * @param opts.limit  max passages to return (default LEARNER_SEARCH_LIMIT)
 * @param opts.sourceKind  optional facet filter ("academic" | "web")
 */
export async function searchLibraryForLearner(
  journeyId: string,
  query: string,
  opts: { limit?: number; sourceKind?: "academic" | "web" } = {},
): Promise<LearnerSearchResult> {
  const limit = opts.limit ?? LEARNER_SEARCH_LIMIT;
  const trimmed = query.trim();
  if (!trimmed) {
    return { query: trimmed, scopedSourceCount: 0, passages: [] };
  }

  // Provenance scope: only sources reachable from this journey's READY bundles.
  // Empty scope -> an ungrounded journey can never leak another journey's data.
  const scopedSourceIds = await resolveJourneySourceIds(journeyId);
  if (scopedSourceIds.length === 0) {
    return { query: trimmed, scopedSourceCount: 0, passages: [] };
  }

  // Embed the query ONCE with the ingest-time model so query and passage vectors
  // live in the same space (dim-3072 enforced inside embedPassages).
  const [vector] = await embedPassages([trimmed]);

  const hits = await searchPassages({
    vector,
    limit: limit * OVERFETCH,
    filter: { sourceIds: scopedSourceIds, sourceKind: opts.sourceKind },
    scoreThreshold: LEARNER_SEARCH_SCORE_FLOOR,
  });

  // Defence in depth: Qdrant payload bundleIds can lag a re-link, so re-assert the
  // PG-authoritative scope and apply the floor here too (never trust the index).
  const allowed = new Set(scopedSourceIds);
  const floored = hits.filter(
    (h) => h.score >= LEARNER_SEARCH_SCORE_FLOOR && allowed.has(h.payload.sourceId),
  );

  const ranked = rankHits(floored).slice(0, limit);
  if (ranked.length === 0) {
    return { query: trimmed, scopedSourceCount: scopedSourceIds.length, passages: [] };
  }

  const sourceById = await loadSources([...new Set(ranked.map((h) => h.payload.sourceId))]);

  const passages: LearnerSearchPassage[] = [];
  for (const h of ranked) {
    const src = sourceById.get(h.payload.sourceId);
    // A hit whose Source row vanished from PG (deleted bundle) is dropped: PG is
    // truth, so an unjoinable index entry is not citable and must not be shown.
    if (!src) continue;
    passages.push({
      chunkId: h.payload.chunkId,
      sourceId: h.payload.sourceId,
      score: h.score,
      preview: h.payload.textPreview,
      ordinal: h.payload.ordinal,
      source: {
        id: src.id,
        kind: src.kind,
        title: src.title,
        canonicalUrl: src.canonicalUrl,
        doi: src.doi,
        attribution: buildAttribution(src),
      },
    });
  }

  return { query: trimmed, scopedSourceCount: scopedSourceIds.length, passages };
}

/**
 * Cosine descending, with a deterministic tie-break so equal scores order
 * stably regardless of Qdrant's internal hit order: by chunkId (a CUID, unique).
 */
function rankHits(hits: PassageHit[]): PassageHit[] {
  return [...hits].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.payload.chunkId.localeCompare(b.payload.chunkId);
  });
}

type SourceRow = Parameters<typeof buildAttribution>[0] & {
  id: string;
  kind: "academic" | "web";
  title: string;
  canonicalUrl: string | null;
  doi: string | null;
};

/** One batched PG round-trip for all hit sources -> id-keyed map. */
async function loadSources(sourceIds: string[]): Promise<Map<string, SourceRow>> {
  if (sourceIds.length === 0) return new Map();
  const rows = await prisma.source.findMany({
    where: { id: { in: sourceIds } },
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
  });
  return new Map(rows.map((r) => [r.id, r as SourceRow]));
}
