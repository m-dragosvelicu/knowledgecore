/**
 * Retrieval layer: nDCG@k / Recall@k / MRR, per the ratified bench design
 * (section 5, item 1 of the mapping table — IR metrics against a synthetic
 * qrels set built from known RAG-library chunks).
 *
 * SKELETON SEAM for the research-engineer stream: this module owns the
 * metric MATH only (pure, no I/O, no qrels construction). The qrels
 * themselves (queries.ts, qrels/) are that stream's deliverable — build a
 * RetrievalEvalItem[] there (see layers/types.ts) and call
 * computeRetrievalLayer(items) to get a LayerReport in the shared schema.
 * Deterministic metrics: cost is always zero, latency is the compute time.
 */
import { startTimer } from "./pricing";
import { buildLayerReport, zeroCost } from "./types";
import type { LayerItemResult, LayerReport, RetrievalEvalItem } from "./types";

function dcgAt(relevances: number[], k: number): number {
  let sum = 0;
  for (let i = 0; i < Math.min(k, relevances.length); i++) {
    sum += relevances[i] / Math.log2(i + 2); // rank is 1-indexed -> log2(rank+1)
  }
  return sum;
}

/** Binary-relevance nDCG@k: relevant chunk ids get relevance 1, everything
 *  else 0. IDCG is the DCG of the ideal ordering (all relevant items first). */
export function ndcgAtK(rankedChunkIds: string[], relevantChunkIds: string[], k: number): number {
  const relevantSet = new Set(relevantChunkIds);
  const gains = rankedChunkIds.map((id) => (relevantSet.has(id) ? 1 : 0));
  const dcg = dcgAt(gains, k);
  const idealGains = new Array(Math.min(relevantSet.size, k)).fill(1);
  const idcg = dcgAt(idealGains, k);
  return idcg === 0 ? 0 : dcg / idcg;
}

export function recallAtK(rankedChunkIds: string[], relevantChunkIds: string[], k: number): number {
  if (relevantChunkIds.length === 0) return 0;
  const relevantSet = new Set(relevantChunkIds);
  const topK = rankedChunkIds.slice(0, k);
  const hit = topK.filter((id) => relevantSet.has(id)).length;
  return hit / relevantSet.size;
}

/** Reciprocal rank of the first relevant hit anywhere in the ranked list. */
export function reciprocalRank(rankedChunkIds: string[], relevantChunkIds: string[]): number {
  const relevantSet = new Set(relevantChunkIds);
  for (let i = 0; i < rankedChunkIds.length; i++) {
    if (relevantSet.has(rankedChunkIds[i])) return 1 / (i + 1);
  }
  return 0;
}

export function scoreRetrievalItem(item: RetrievalEvalItem, k = 10): LayerItemResult {
  const stop = startTimer();
  const metrics = {
    ndcgAtK: ndcgAtK(item.rankedChunkIds, item.relevantChunkIds, k),
    recallAtK: recallAtK(item.rankedChunkIds, item.relevantChunkIds, k),
    mrr: reciprocalRank(item.rankedChunkIds, item.relevantChunkIds),
    k,
  };
  return {
    itemId: item.itemId,
    layer: "retrieval",
    metrics,
    cost: zeroCost(stop()),
  };
}

export function computeRetrievalLayer(items: RetrievalEvalItem[], k = 10): LayerReport {
  const results = items.map((item) => scoreRetrievalItem(item, k));
  return buildLayerReport("retrieval", results);
}
