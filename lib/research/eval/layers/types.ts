/**
 * Shared types for the layered eval bench (E05). Design ratified by the CEO
 * 2026-08-07, see team-v2/knowledgecore/reading-room/eval-metrics-verification-2026-08-07.html
 * section 5 (Paramythis, Weibelzahl & Masthoff 2010, layered evaluation for
 * adaptive systems): score each stage of the pipeline separately instead of
 * collapsing everything into one end-to-end number.
 *
 * Five layers, one module each (this directory):
 *   retrieval.ts    — nDCG / Recall@k / MRR against a synthetic qrels set.
 *                      Math lives here; the qrels themselves are built by the
 *                      research-engineer stream (queries.ts / qrels/).
 *   grounding.ts     — ALCE-style citation precision/recall + FActScore-style
 *                      atomic-fact check. Fully implemented, this stream.
 *   surface.ts       — BERTScore-equivalent (embedding greedy-match) + ROUGE-
 *                      equivalent + Flesch-Kincaid. Fully implemented, this
 *                      stream.
 *   pedagogical.ts   — adapter seam onto the cross-family judge-panel study
 *                      (ai-engineer stream, judge-validation/). Skeleton only
 *                      here: defines the shape this harness expects back.
 *   external.ts      — periodic sanity check against published external
 *                      benchmarks (TutorEval, MathTutorBench). Skeleton only,
 *                      no live wiring yet.
 *
 * Every layer emits LayerItemResult[] (per-item metrics + cost/latency) and
 * an aggregate LayerReport. runManifest.ts records which layers ran, on what
 * input, and when, so a bench run is reproducible and auditable.
 */

export type LayerName = "retrieval" | "grounding" | "surface" | "pedagogical" | "external";

/** Per-item cost/latency telemetry. Every layer's compute function fills this
 *  in for every item — the CEO's item 4 requirement is "computed, not
 *  asserted", so this is the single shape all cost math flows through. */
export interface ItemCost {
  /** Provider-reported or estimated input tokens for this item's model call(s). */
  inputTokens: number;
  outputTokens: number;
  /** Resolved from pricing.ts; 0 for calls with no priced model (e.g. pure
   *  deterministic metrics like Flesch-Kincaid, which cost nothing). */
  costUsd: number;
  latencyMs: number;
  /** Model id(s) used for this item, joined with "+" if more than one call
   *  contributed (e.g. an embedding call plus a judge call). Empty string for
   *  deterministic-only items. */
  model: string;
}

export function zeroCost(latencyMs = 0): ItemCost {
  return { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs, model: "" };
}

export function sumCost(a: ItemCost, b: ItemCost): ItemCost {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
    latencyMs: a.latencyMs + b.latencyMs,
    model: [a.model, b.model].filter(Boolean).join("+"),
  };
}

/** One item's result within a layer. `metrics` is intentionally a loose bag
 *  (each layer defines its own metric names) so this one type serves all
 *  five layers without a union of five near-identical shapes. */
export interface LayerItemResult {
  itemId: string;
  layer: LayerName;
  metrics: Record<string, number | string | boolean | null>;
  cost: ItemCost;
  notes?: string;
}

/** Aggregate report for one layer run. */
export interface LayerReport {
  layer: LayerName;
  ranAt: string; // ISO 8601
  items: LayerItemResult[];
  /** Mean of each numeric metric key across items, for a quick read. */
  aggregateMetrics: Record<string, number>;
  totalCostUsd: number;
  totalLatencyMs: number;
}

/** Computes aggregateMetrics/totalCostUsd/totalLatencyMs from items so every
 *  layer module reports the same way instead of hand-rolling aggregation. */
export function buildLayerReport(layer: LayerName, items: LayerItemResult[]): LayerReport {
  const numericKeys = new Set<string>();
  for (const item of items) {
    for (const [k, v] of Object.entries(item.metrics)) {
      if (typeof v === "number") numericKeys.add(k);
    }
  }
  const aggregateMetrics: Record<string, number> = {};
  for (const key of numericKeys) {
    const values = items
      .map((i) => i.metrics[key])
      .filter((v): v is number => typeof v === "number");
    aggregateMetrics[key] = values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : 0;
  }
  return {
    layer,
    ranAt: new Date().toISOString(),
    items,
    aggregateMetrics,
    totalCostUsd: items.reduce((sum, i) => sum + i.cost.costUsd, 0),
    totalLatencyMs: items.reduce((sum, i) => sum + i.cost.latencyMs, 0),
  };
}

// --- Grounding layer input shapes -----------------------------------------

/** One chunk from the RAG library, or a synthetic stand-in for a smoke test. */
export interface SourceChunkRef {
  id: string;
  text: string;
}

/** One atomic claim inside generated content, with the chunk ids it cited. */
export interface GeneratedClaim {
  id: string;
  text: string;
  citedChunkIds: string[];
}

export interface GroundingEvalItem {
  itemId: string;
  generatedText: string;
  claims: GeneratedClaim[];
  /** The corpus slice available for citation (RAG library, or a synthetic
   *  slice for a smoke test). FActScore checks generatedText's atomic facts
   *  against this same corpus. */
  corpus: SourceChunkRef[];
}

// --- Surface layer input shapes --------------------------------------------

export interface SurfaceEvalItem {
  itemId: string;
  generatedText: string;
  /** Silver or gold reference text. Optional: BERTScore/ROUGE-equivalent
   *  metrics are skipped (not scored 0) when absent; Flesch-Kincaid never
   *  needs one. */
  referenceText?: string;
}

// --- Retrieval layer input shapes (math lives here; qrels come from the
// research-engineer stream) -------------------------------------------------

export interface RetrievalEvalItem {
  itemId: string;
  /** Chunk ids in the order the retriever returned them, best first. */
  rankedChunkIds: string[];
  /** Ground-truth relevant chunk ids for this query (the qrels). */
  relevantChunkIds: string[];
}

// --- Pedagogical layer adapter shape (judge-panel results are produced by
// the ai-engineer stream in judge-validation/; this harness only consumes
// them in this shape) --------------------------------------------------------

export interface PedagogicalJudgeScore {
  itemId: string;
  judgeKey: string; // matches JudgeModel.key in judge-validation/providers.ts
  dimensionScores: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  model: string;
}

// --- Run manifest ------------------------------------------------------------

export interface RunManifestLayerEntry {
  layer: LayerName;
  ran: boolean;
  itemCount: number;
  /** Free-text description of what corpus/item set this layer ran on
   *  ("2 synthetic smoke items", "N=40 generated-content sample", etc). */
  ranOn: string;
  totalCostUsd: number;
  totalLatencyMs: number;
}

export interface RunManifest {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  layers: RunManifestLayerEntry[];
  notes?: string;
}
