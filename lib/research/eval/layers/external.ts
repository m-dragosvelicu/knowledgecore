/**
 * External layer: SKELETON ONLY, not wired to live data. Per the ratified
 * report's recommendation (section 5): "periodically sanity-check the
 * tutoring behavior against the published TutorEval and MathTutorBench test
 * sets as an external, out-of-distribution check that the internal rubric is
 * not simply overfit to itself." Not implemented this task ("no full runs" —
 * the brief also scopes only grounding/surface as fully implemented layers).
 *
 * Seam for a future task: an ExternalBenchResult carries a benchmark name, a
 * score against that published benchmark's own scoring method (TutorEval:
 * automated grading against its expert-authored rubric; MathTutorBench: its
 * trained reward-model scorer), and the same cost/latency shape as every
 * other layer so it folds into the same LayerReport without a new schema.
 */
import { buildLayerReport } from "./types";
import type { ItemCost, LayerItemResult, LayerReport } from "./types";

export type ExternalBenchmarkName = "tutoreval" | "mathtutorbench";

export interface ExternalBenchResult {
  itemId: string;
  benchmark: ExternalBenchmarkName;
  score: number;
  cost: ItemCost;
}

export function computeExternalLayer(results: ExternalBenchResult[]): LayerReport {
  const items: LayerItemResult[] = results.map((r) => ({
    itemId: r.itemId,
    layer: "external",
    metrics: { benchmark: r.benchmark, score: r.score },
    cost: r.cost,
  }));
  return buildLayerReport("external", items);
}

// TODO (future task, not this one): wire a TutorEval/MathTutorBench runner
// that produces ExternalBenchResult[] against KnowledgeCore's own generated
// content, and a schedule for how often the periodic sanity check runs.
