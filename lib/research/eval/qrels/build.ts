/**
 * Qrels construction: label which chunks in a topic's candidate pool are
 * relevant to a given query. Thin wrapper over the SAME judge function the
 * D4 embedding eval already uses (labelRelevantChunks in ../judge.ts) — this
 * module does not re-implement labelling, it generalizes the call pattern
 * (single query -> single topic's chunks -> QUERIES_V2's 78 queries across 9
 * topics) and shapes the result into the QrelsEntry/QrelsSet types the
 * retrieval-layer bench (nDCG/Recall@k/MRR) consumes.
 *
 * See qrels/README.md for the honest method statement (single-LLM-judge,
 * cross-check status).
 */
import type { GeminiClient } from "../../../llm/gemini";
import { labelRelevantChunks } from "../judge";
import type { EvalQuery } from "../queries";
import type { Chunk, QrelsEntry, QrelsSet } from "./types";

const JUDGE_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

/** Label one query's relevant chunks against its topic's candidate pool. */
export async function buildQrelsForQuery(client: GeminiClient, query: EvalQuery, chunks: Chunk[]): Promise<QrelsEntry> {
  const candidateChunkIds = chunks.map((c) => c.id);
  const base = {
    queryId: query.id,
    topic: query.topic,
    candidateChunkIds,
    judgeModel: JUDGE_MODEL,
    labelledAt: new Date().toISOString(),
  };
  if (!chunks.length) {
    return { ...base, relevantChunkIds: [] };
  }
  try {
    const labelled = await labelRelevantChunks(client, {
      level: query.level,
      query: query.query,
      chunks: chunks.map((c) => ({ id: c.id, text: c.text })),
    });
    // Defend against a hallucinated chunk id from the judge (e.g. it invents an
    // id not in the candidate list) — same guard run-embeddings.ts already
    // applies (see filter(id => chunks.some(...)) there).
    const validIds = new Set(candidateChunkIds);
    return { ...base, relevantChunkIds: labelled.relevantChunkIds.filter((id) => validIds.has(id)) };
  } catch (e) {
    return { ...base, relevantChunkIds: [], error: (e as Error).message };
  }
}

/**
 * Label every query in `queries` against its topic's chunk pool in
 * `chunksByTopic` (as built by corpus.ts). Sequential, same as
 * run-embeddings.ts's ground-truth loop — Gemini has no batch endpoint for
 * this call shape, and sequential keeps judge cost/latency easy to reason
 * about for a CEO-facing cost table.
 */
export async function buildQrelsSet(
  client: GeminiClient,
  queries: EvalQuery[],
  chunksByTopic: Record<string, Chunk[]>,
  onProgress?: (done: number, total: number) => void,
): Promise<QrelsSet> {
  const out: QrelsSet = {};
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    out[q.id] = await buildQrelsForQuery(client, q, chunksByTopic[q.topic] ?? []);
    onProgress?.(i + 1, queries.length);
  }
  return out;
}

/** How many queries in a QrelsSet got at least one relevant chunk labelled. */
export function countLabelled(qrels: QrelsSet): number {
  return Object.values(qrels).filter((e) => e.relevantChunkIds.length > 0).length;
}
