/**
 * LLM cost estimation for telemetry (LlmCall.costMicroUsd).
 *
 * costMicroUsd is stored as integer microdollars (USD * 1_000_000) to avoid
 * float drift. Rates below are USD per 1,000,000 tokens, keyed by a lowercase
 * substring of the provider-reported model id. The first matching entry wins,
 * so order more specific keys before more general ones.
 *
 * If no entry matches, computeCostMicroUsd returns 0 (tokens are still recorded
 * as real); add the model to PRICE_TABLE to start costing it.
 */

type Rate = {
  /** USD per 1M input (prompt) tokens. */
  inputPerMillionUsd: number;
  /** USD per 1M output (completion) tokens. */
  outputPerMillionUsd: number;
};

// Substring -> rate. Keep keys lowercase. Rates are list prices per 1M tokens.
const PRICE_TABLE: ReadonlyArray<readonly [string, Rate]> = [
  // Google Gemini — the live default for L0 services.
  // Flash-Lite tier: the cheapest structured-output-capable Gemini, used for the
  // tiny intent-parse / subject-extraction call. List price ~$0.10 in / $0.40 out
  // per 1M tokens. Keyed BEFORE the heavier "flash" entries so a "flash-lite" id
  // matches its lite rate rather than the more general "flash" substring.
  ["gemini-3.1-flash-lite", { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 }],
  ["gemini-2.5-flash-lite", { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 }],
  ["flash-lite", { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 }],
  // gemini-3.5-flash list price (paid tier): $0.30 in / $2.50 out per 1M tokens.
  ["gemini-3.5-flash", { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 }],
  // Older Flash family kept for any fallback dispatch.
  ["gemini-2.5-flash", { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 }],
  ["gemini-1.5-flash", { inputPerMillionUsd: 0.075, outputPerMillionUsd: 0.3 }],
  // Anthropic — used by the AnthropicClient when selected.
  ["claude-sonnet", { inputPerMillionUsd: 3.0, outputPerMillionUsd: 15.0 }],
  ["claude-haiku", { inputPerMillionUsd: 0.8, outputPerMillionUsd: 4.0 }],
  // Paralon (Qwen3) — open-weight hosting; nominal rate.
  ["qwen3", { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 }],
];

function lookupRate(model: string): Rate | null {
  const m = model.toLowerCase();
  for (const [key, rate] of PRICE_TABLE) {
    if (m.includes(key)) return rate;
  }
  return null;
}

/**
 * Compute the integer microdollar cost for a call. Returns 0 (not an error) when
 * the model is not in PRICE_TABLE so the row still carries real token counts.
 * // TODO: add new model ids to PRICE_TABLE as they go live so cost stops being 0.
 */
export function computeCostMicroUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = lookupRate(model);
  if (!rate) return 0;
  const inUsd = (inputTokens / 1_000_000) * rate.inputPerMillionUsd;
  const outUsd = (outputTokens / 1_000_000) * rate.outputPerMillionUsd;
  return Math.round((inUsd + outUsd) * 1_000_000);
}
