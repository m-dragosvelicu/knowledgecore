/**
 * Single cost config for the eval bench (CEO item 4: "cost per eval item is
 * computed, not asserted"). Reuses the two pricing sources that already exist
 * in the tree rather than inventing a third table:
 *   - lib/llm/pricing.ts PRICE_TABLE — production LLM $/1M-token rates
 *     (substring match on model id), used for judge/entailment/decomposition
 *     calls in the grounding layer.
 *   - lib/research/embeddings/clients.ts EMBED_MODELS — embedding $/1M-token
 *     rates, used for the surface layer's embedding-similarity metric.
 * Both are read-only imports; this file adds no new pricing data of its own,
 * only the USD-per-item computation the layers call into.
 */
import { computeCostMicroUsd } from "../../../llm/pricing";
import { EMBED_MODELS } from "../../embeddings/clients";

/** LLM call cost in USD (converts lib/llm/pricing.ts's microdollar integer). */
export function llmCallCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  return computeCostMicroUsd(model, inputTokens, outputTokens) / 1_000_000;
}

/** Embedding call cost in USD. Falls back to 0 (not an estimate) if the model
 *  id isn't in EMBED_MODELS, mirroring computeCostMicroUsd's own "0 when
 *  unpriced" convention rather than silently guessing a rate. */
export function embedCallCostUsd(modelId: string, tokens: number): number {
  const model = EMBED_MODELS.find((m) => m.id === modelId);
  if (!model) return 0;
  return (tokens / 1_000_000) * model.pricePerMTokensUsd;
}

/** Wall-clock timer helper so every layer measures latency the same way. */
export function startTimer(): () => number {
  const start = performance.now();
  return () => Math.round(performance.now() - start);
}
