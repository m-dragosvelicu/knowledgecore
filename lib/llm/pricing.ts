/**
 * Cost estimation for telemetry (LlmCall.costMicroUsd), stored as integer
 * microdollars (USD * 1e6) to avoid float drift. Two shapes are priced here:
 * (1) token-metered LLM/embedding calls (computeCostMicroUsd, rates keyed by
 * a lowercase substring of the provider-reported model id -- first match
 * wins, so order specific keys before general ones); (2) flat per-request
 * external API calls that carry no token cost (computeExternalCallCostMicroUsd,
 * e.g. Tavily/OpenAlex/Semantic Scholar). Both return 0 (not an error) when
 * no entry matches; add the model/source to price it.
 */

type Rate = {
  /** USD per 1M input (prompt) tokens. */
  inputPerMillionUsd: number;
  /** USD per 1M output (completion) tokens. */
  outputPerMillionUsd: number;
};

// Substring -> rate. Keep keys lowercase. Rates are list prices per 1M tokens.
const PRICE_TABLE: ReadonlyArray<readonly [string, Rate]> = [
  // Google Gemini — the live default for L0 services. Flash-Lite entries are
  // keyed before the heavier "flash" entries so a "flash-lite" id matches its
  // lite rate rather than the more general "flash" substring.
  ["gemini-3.1-flash-lite", { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 }],
  ["gemini-2.5-flash-lite", { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 }],
  ["flash-lite", { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 }],
  ["gemini-3.5-flash", { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 }],
  // Older Flash family kept for any fallback dispatch.
  ["gemini-2.5-flash", { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 }],
  ["gemini-1.5-flash", { inputPerMillionUsd: 0.075, outputPerMillionUsd: 0.3 }],
  // Anthropic — used by the AnthropicClient when selected.
  ["claude-sonnet", { inputPerMillionUsd: 3.0, outputPerMillionUsd: 15.0 }],
  ["claude-haiku", { inputPerMillionUsd: 0.8, outputPerMillionUsd: 4.0 }],
  // Paralon (Qwen3) — open-weight hosting; nominal rate.
  ["qwen3", { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 }],
  // Gemini Embedding (ADR 9, ratified 2026-06-03: gemini-embedding-001, dim
  // 3072 -- see lib/research/embeddings/embed.ts). Embeddings have no output
  // tokens; outputPerMillionUsd is 0 so a batch with outputTokens=0 costs
  // exactly the input-token line. $0.15/M input tokens is Google's published
  // Gemini Developer API list price for gemini-embedding-001 at the time this
  // was added (2026-08-08).
  ["gemini-embedding-001", { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0 }],
];

function lookupRate(model: string): Rate | null {
  const m = model.toLowerCase();
  for (const [key, rate] of PRICE_TABLE) {
    if (m.includes(key)) return rate;
  }
  return null;
}

/** Compute the integer microdollar cost for a call; 0 when model is unpriced. */
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

// ---------------------------------------------------------------------------
// Non-LLM external API calls (Tavily, OpenAlex, Semantic Scholar) — the
// production Research Agent's per-journey research fill
// (lib/services/providers/researchAgent.service.ts) makes these. They have no
// token cost, only a per-request price. Recorded as LlmCall rows with a
// dedicated purpose and zero tokens (see lib/llm/externalCallTelemetry.ts)
// rather than a new table, per the cost-gap-close task's "minimal schema
// impact" instruction — the existing purpose/model groupBy breakdowns in
// /api/admin/llm-costs already work unmodified for any purpose value.
// ---------------------------------------------------------------------------

export type ExternalCallSource = "tavily" | "openalex" | "semantic_scholar";

type ExternalCallRate = {
  /** Flat USD cost per request, converted to microdollars at lookup time. */
  usdPerRequest: number;
  /** Where this price came from — required so a stale/guessed number is never silent. */
  priceSource: string;
};

const EXTERNAL_CALL_PRICE_TABLE: Readonly<Record<ExternalCallSource, ExternalCallRate>> = {
  // MultiSourceResearchAgent always calls webSearch with searchDepth:"basic"
  // (fetchWebSources, lib/services/providers/researchAgent.service.ts) — the
  // cheaper Tavily search tier. Current app usage sits inside Tavily's free
  // tier: ADR 9 (ratified 2026-06-03) states "Tavily's free tier is
  // sufficient at current scale" (team-v2/knowledgecore/decisions/
  // 2026-06-03-adr9-web-search-source-strategy.html). Recorded as $0/request,
  // not because Tavily is free in general (it bills per-credit past the free
  // monthly allotment; see https://tavily.com/#pricing at the time usage
  // needs re-checking), but because this app has never crossed that
  // threshold. Requests are still counted (see purpose=external_tavily_search)
  // so a future scale-up shows up as a request-volume signal even while cost
  // reads 0 -- update usdPerRequest here once the account is on a paid plan.
  tavily: { usdPerRequest: 0, priceSource: "ADR 9 (2026-06-03): free tier, not yet exceeded" },
  // OpenAlex is a free, open bibliographic API. OPENALEX_API_KEY became
  // mandatory 2026-02-13 when the mailto polite-pool was dropped (see the
  // error text in lib/research/openalex.ts:requireApiKey), but that key gates
  // rate-limit tier, not billing — OpenAlex has no paid API tier.
  openalex: { usdPerRequest: 0, priceSource: "openalex.org: free public API, no billed tier" },
  // Semantic Scholar's Academic Graph API is free; SEMANTIC_SCHOLAR_API_KEY
  // (optional, lib/research/semanticScholar.ts:headers) only raises the rate
  // limit, it does not introduce a per-request charge.
  semantic_scholar: {
    usdPerRequest: 0,
    priceSource: "api.semanticscholar.org: free public API, no billed tier",
  },
};

/** Compute the integer microdollar cost for one external API request. */
export function computeExternalCallCostMicroUsd(source: ExternalCallSource): number {
  const rate = EXTERNAL_CALL_PRICE_TABLE[source];
  if (!rate) return 0;
  return Math.round(rate.usdPerRequest * 1_000_000);
}
