/**
 * Corpus construction for the retrieval-layer qrels (CEO plan §5 pattern:
 * "synthetic query-to-known-chunk qrels"). Two entry points:
 *
 * - buildTopicCorpusFromExtractions: the real path. Mirrors the
 *   topicUrls -> chunkText loop already in
 *   ../../embeddings/run-embeddings.ts (steps 1), generalized to accept any
 *   query/topic list instead of hardcoding the V1 QUERIES/TOPICS import, so
 *   the same corpus builder works for QUERIES_V2 once a harness has run
 *   run-search.ts-style fetch+extract for the V2 topics and written
 *   extractions.json/raw-search.json in the same shape.
 * - buildCorpusFromTexts: a lightweight path for tests/smoke runs that does
 *   not require live Tavily/extraction — takes raw {url, text} docs directly.
 *
 * Neither function performs network I/O itself; fetching is the harness's
 * job (out of this module's scope — see qrels/README.md).
 */
import { chunkText, type Chunk } from "../../embeddings/chunk";
import type { EngineResult, Extraction } from "../types";
import type { EvalQuery } from "../queries";

const DEFAULT_MAX_CHUNKS_PER_TOPIC = 60;
/** Same corpus-per-source cap as run-embeddings.ts: keeps one long page from dominating a topic's corpus. */
const MAX_CHARS_PER_SOURCE = 12000;

/**
 * Build one topic's chunk pool from already-extracted page text, keyed by URL.
 * `rawSearch` supplies which URLs belong to which topic (via each query's
 * `topic` field); `extractions` supplies the clean text per URL.
 */
export function buildTopicCorpusFromExtractions(
  topic: string,
  queries: EvalQuery[],
  rawSearch: EngineResult[],
  extractions: Record<string, Extraction>,
  maxChunksPerTopic: number = DEFAULT_MAX_CHUNKS_PER_TOPIC,
): Chunk[] {
  const byQuery = new Map<string, string>(queries.map((q) => [q.query, q.topic]));
  const urls = new Set<string>();
  for (const r of rawSearch) {
    if (byQuery.get(r.query) !== topic) continue;
    for (const h of r.hits) urls.add(h.url);
  }

  const chunks: Chunk[] = [];
  let srcIdx = 0;
  for (const url of urls) {
    const ex = extractions[url];
    if (!ex?.ok || !ex.text) continue;
    const prefix = `${topic.replace(/\s+/g, "")}-s${srcIdx++}`;
    const trimmed = ex.text.slice(0, MAX_CHARS_PER_SOURCE);
    for (const c of chunkText(url, trimmed, prefix)) {
      chunks.push(c);
      if (chunks.length >= maxChunksPerTopic) break;
    }
    if (chunks.length >= maxChunksPerTopic) break;
  }
  return chunks;
}

/**
 * Build every topic's chunk pool in one pass. Convenience wrapper over
 * buildTopicCorpusFromExtractions for a harness that already has the
 * extractions/raw-search bundle in memory.
 */
export function buildAllTopicCorpora(
  topics: readonly string[],
  queries: EvalQuery[],
  rawSearch: EngineResult[],
  extractions: Record<string, Extraction>,
  maxChunksPerTopic: number = DEFAULT_MAX_CHUNKS_PER_TOPIC,
): Record<string, Chunk[]> {
  const out: Record<string, Chunk[]> = {};
  for (const topic of topics) {
    out[topic] = buildTopicCorpusFromExtractions(topic, queries, rawSearch, extractions, maxChunksPerTopic);
  }
  return out;
}

/**
 * Test/smoke path: build a small chunk pool directly from raw text, no
 * extraction pipeline required. Used by smoke.ts (n=2) and by any future unit
 * test that wants a deterministic corpus without live network calls.
 */
export function buildCorpusFromTexts(topic: string, docs: { url: string; text: string }[]): Chunk[] {
  const chunks: Chunk[] = [];
  let srcIdx = 0;
  for (const doc of docs) {
    const prefix = `${topic.replace(/\s+/g, "")}-s${srcIdx++}`;
    chunks.push(...chunkText(doc.url, doc.text, prefix));
  }
  return chunks;
}
