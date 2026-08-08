/**
 * Pedagogical layer: SKELETON ONLY. Full implementation is the ai-engineer
 * stream's deliverable in judge-validation/ (cross-family judge panel +
 * inter-judge kappa, per the bias literature cited in the ratified report,
 * section 3 item 5: MT-Bench/position-bias/self-preference). Do not
 * reimplement that here — this module is the adapter seam that folds
 * judge-validation's per-model scores into this harness's shared LayerReport
 * schema, once that stream lands.
 *
 * Expected input shape: PedagogicalJudgeScore[] (layers/types.ts), one entry
 * per (item, judge) pair — matches judge-validation/providers.ts's
 * JsonCallResult + JudgeModel.key. This module does NOT compute kappa itself
 * (that is judge-validation/stats.ts's job); it only aggregates per-item mean
 * dimension scores and rolls up cost/latency into the shared schema so the
 * pedagogical layer's manifest entry looks like every other layer's.
 */
import { JUDGE_PANEL, usdFor } from "../judge-validation/providers";
import { buildLayerReport } from "./types";
import type { ItemCost, LayerItemResult, LayerReport, PedagogicalJudgeScore } from "./types";

/**
 * Cost authority for this layer is judge-validation/providers.ts's JUDGE_PANEL
 * + usdFor — the SAME table run.ts and smoke-panel.ts use to price every
 * judge call in this study (Gemini direct + GPT-5.4-mini/Claude Sonnet 5 via
 * OpenRouter). Do NOT fall back to lib/llm/pricing.ts's PRICE_TABLE here: that
 * table prices production direct-API calls only, has no OpenRouter entry for
 * gpt-5.4-mini at all (silently costs $0), and keys Claude at the direct-API
 * rate (3.0/15.0) rather than OpenRouter's actual rate (2.0/10.0) — see QA
 * DECISIONS.md 2026-08-07 for the discrepancy this caused.
 */
function judgeCostUsd(judgeKey: string, inputTokens: number, outputTokens: number): number {
  const judge = JUDGE_PANEL.find((j) => j.key === judgeKey);
  if (!judge) {
    throw new Error(
      `judgeCostUsd: no JUDGE_PANEL entry for judgeKey "${judgeKey}" — add it to judge-validation/providers.ts rather than costing it as $0.`,
    );
  }
  return usdFor(judge, inputTokens, outputTokens);
}

function meanDimensionScores(scores: PedagogicalJudgeScore[]): Record<string, number> {
  const keys = new Set(scores.flatMap((s) => Object.keys(s.dimensionScores)));
  const out: Record<string, number> = {};
  for (const key of keys) {
    const values = scores.map((s) => s.dimensionScores[key]).filter((v): v is number => typeof v === "number");
    out[key] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }
  return out;
}

/** Folds a panel's per-judge scores for ONE item into a single LayerItemResult
 *  (mean across judges per dimension, summed cost across judges). Does not
 *  compute inter-judge agreement — that lives in judge-validation/stats.ts
 *  and is reported alongside, not inside, this per-item roll-up. */
export function foldPedagogicalItem(itemId: string, scoresForItem: PedagogicalJudgeScore[]): LayerItemResult {
  const meanScores = meanDimensionScores(scoresForItem);
  const cost: ItemCost = scoresForItem.reduce<ItemCost>(
    (acc, s) => ({
      inputTokens: acc.inputTokens + s.inputTokens,
      outputTokens: acc.outputTokens + s.outputTokens,
      costUsd: acc.costUsd + judgeCostUsd(s.judgeKey, s.inputTokens, s.outputTokens),
      latencyMs: acc.latencyMs + s.latencyMs,
      model: [acc.model, s.judgeKey].filter(Boolean).join("+"),
    }),
    { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0, model: "" },
  );
  return {
    itemId,
    layer: "pedagogical",
    metrics: { ...meanScores, judgeCount: scoresForItem.length },
    cost,
  };
}

export function computePedagogicalLayer(scores: PedagogicalJudgeScore[]): LayerReport {
  const byItem = new Map<string, PedagogicalJudgeScore[]>();
  for (const s of scores) {
    const list = byItem.get(s.itemId) ?? [];
    list.push(s);
    byItem.set(s.itemId, list);
  }
  const results = Array.from(byItem.entries()).map(([itemId, list]) => foldPedagogicalItem(itemId, list));
  return buildLayerReport("pedagogical", results);
}
