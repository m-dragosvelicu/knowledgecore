/**
 * Embedding client adapters for the D4 eval: Gemini Embedding
 * (gemini-embedding-001) via @google/genai, and Qwen3-Embedding-8B/-4B via
 * OpenRouter's OpenAI-compatible /embeddings. Each records its live vector
 * dimension and per-1M-token price (USD, provider's public pricing at eval
 * time), and exposes a batched embed().
 */
import { GoogleGenAI } from "@google/genai";
import { withRetry } from "../retry";

/**
 * Best-effort usage telemetry for one embed() call (Step 6 cost table).
 * `costUsd`: real, provider-reported cost when available (OpenRouter returns
 * it per call); null when the provider doesn't report it, so callers must
 * derive USD from tokens * pricePerMTokensUsd instead of assuming a number.
 * `tokensEstimated`: true when tokens are a heuristic, not provider-reported
 * (the Generative Language API's embedContent has no usageMetadata -- the
 * per-text token count field on ContentEmbedding is documented Vertex-API-
 * only and was empirically absent when smoke-tested against this API key,
 * 2026-07-30).
 */
export interface EmbedUsage {
  tokens: number;
  tokensEstimated: boolean;
  costUsd: number | null;
}

export type EmbedUsageCallback = (usage: EmbedUsage) => void;

export interface EmbedModel {
  id: string;
  label: string;
  provider: "gemini" | "openrouter";
  /** USD per 1M input tokens, from the provider's public pricing (cited in results). */
  pricePerMTokensUsd: number;
  priceSource: string;
  /** Document/chunk side. ALWAYS bare text -- Qwen3-Embedding convention keeps
   *  the corpus side unprefixed even when the query side takes an instruction. */
  embed(texts: string[], onUsage?: EmbedUsageCallback): Promise<number[][]>;
  /**
   * Query-side embed, only set on instruction-prefixed variants (see
   * QWEN_INSTRUCT_QUERY_TEMPLATE below). run-embeddings.ts calls
   * `model.embedQuery ?? model.embed` for the query vector so every existing
   * model (bare Qwen, Gemini) is unaffected -- this is purely additive.
   */
  embedQuery?(texts: string[], onUsage?: EmbedUsageCallback): Promise<number[][]>;
}

// Qwen3-Embedding models expect an instruction prefix on the QUERY side for
// retrieval tasks (see the model card / Qwen3-Embedding technical report).
// OpenRouter's raw /embeddings endpoint has no instruction hook, so the
// archived 2026-06-03 run embedded bare queries -- this template lets a
// re-run test the documented convention directly, apples-to-apples against
// the bare variant in the same run.
export const QWEN_INSTRUCT_QUERY_TEMPLATE =
  "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: {query}";

function qwenInstructQuery(query: string): string {
  return QWEN_INSTRUCT_QUERY_TEMPLATE.replace("{query}", query);
}

const gemini = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });

// Same word-count heuristic as CHUNK_SCHEME.tokenApprox (chunk.ts): no
// tokenizer dependency, directional bench only. Used ONLY for Gemini, whose
// embedContent response carries no usage/token metadata on this API-key path
// (confirmed empirically 2026-07-30, see EmbedUsage doc above).
function estimateTokens(text: string): number {
  return Math.round(text.split(/\s+/).filter(Boolean).length / 0.75);
}

/** Gemini embeds one content per call in this SDK version; map sequentially. */
async function geminiEmbed(modelId: string, texts: string[], onUsage?: EmbedUsageCallback): Promise<number[][]> {
  const out: number[][] = [];
  for (const t of texts) {
    const r = await withRetry(() => gemini.models.embedContent({ model: modelId, contents: t }), {
      label: `gemini-embed:${modelId}`,
    });
    // SDK shape: { embeddings: [{ values: number[] }] }
    const values =
      (r as { embeddings?: { values?: number[] }[] }).embeddings?.[0]?.values ??
      (r as { embedding?: { values?: number[] } }).embedding?.values;
    if (!values) throw new Error(`Gemini embedContent returned no values for ${modelId}`);
    out.push(values);
    onUsage?.({ tokens: estimateTokens(t), tokensEstimated: true, costUsd: null });
  }
  return out;
}

async function openRouterEmbed(modelId: string, texts: string[], onUsage?: EmbedUsageCallback): Promise<number[][]> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  // Retry wraps the status check too, not just the fetch(): a non-2xx
  // response resolves normally (fetch only rejects on a network failure), so
  // the HTTP-status throw has to happen INSIDE the retried callback for a
  // 429/5xx to actually trigger a retry.
  const data = await withRetry(
    async () => {
      const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId, input: texts }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(`OpenRouter embeddings failed (${modelId}): ${res.status} ${text.slice(0, 200)}`);
        (err as Error & { status: number }).status = res.status;
        throw err;
      }
      return (await res.json()) as {
        data?: { embedding: number[]; index: number }[];
        usage?: { prompt_tokens?: number; total_tokens?: number; cost?: number };
      };
    },
    { label: `openrouter-embed:${modelId}` },
  );
  const rows = (data.data ?? []).slice().sort((a, b) => a.index - b.index);
  // OpenRouter reports real prompt_tokens + cost (USD) per call -- use them
  // directly rather than estimating (confirmed empirically 2026-07-30).
  if (data.usage) {
    onUsage?.({
      tokens: data.usage.total_tokens ?? data.usage.prompt_tokens ?? 0,
      tokensEstimated: false,
      costUsd: typeof data.usage.cost === "number" ? data.usage.cost : null,
    });
  }
  return rows.map((r) => r.embedding);
}

export const EMBED_MODELS: EmbedModel[] = [
  {
    id: "gemini-embedding-001",
    label: "Gemini Embedding (gemini-embedding-001)",
    provider: "gemini",
    pricePerMTokensUsd: 0.15,
    priceSource: "ai.google.dev/gemini-api/docs/pricing (paid tier, 2026-06-03): $0.15 / 1M input tokens",
    embed: (texts, onUsage) => geminiEmbed("gemini-embedding-001", texts, onUsage),
  },
  {
    id: "qwen/qwen3-embedding-8b",
    label: "Qwen3-Embedding-8B (OpenRouter)",
    provider: "openrouter",
    pricePerMTokensUsd: 0.01,
    priceSource: "openrouter.ai/qwen/qwen3-embedding-8b (2026-06-03): $0.01 / 1M tokens",
    embed: (texts, onUsage) => openRouterEmbed("qwen/qwen3-embedding-8b", texts, onUsage),
  },
  {
    id: "qwen/qwen3-embedding-4b",
    label: "Qwen3-Embedding-4B (OpenRouter)",
    provider: "openrouter",
    pricePerMTokensUsd: 0.02,
    priceSource: "openrouter.ai/qwen/qwen3-embedding-4b (2026-06-03): $0.02 / 1M tokens",
    embed: (texts, onUsage) => openRouterEmbed("qwen/qwen3-embedding-4b", texts, onUsage),
  },
  // NOTE: Qwen3-Embedding-0.6B is intentionally absent. The canonical slug
  // qwen/qwen3-embedding-0.6b returns HTTP 404 "No endpoints found" on
  // OpenRouter's embeddings endpoint (verified 2026-06-03). Recorded as a gap in
  // RESULTS-SUMMARY.md rather than faked.

  // Instruction-prefixed QUERY-side variants (resolves the documented Qwen
  // caveat in RESULTS-SUMMARY.md). Document/chunk embedding is identical to
  // the bare model above (embed() is unprefixed) -- only embedQuery() applies
  // QWEN_INSTRUCT_QUERY_TEMPLATE. Distinct `id` so results/collections don't
  // collide with the bare variant; same underlying OpenRouter model+price.
  {
    id: "qwen/qwen3-embedding-8b-instruct-query",
    label: "Qwen3-Embedding-8B (instruct-prefixed query)",
    provider: "openrouter",
    pricePerMTokensUsd: 0.01,
    priceSource: "openrouter.ai/qwen/qwen3-embedding-8b (2026-06-03): $0.01 / 1M tokens",
    embed: (texts, onUsage) => openRouterEmbed("qwen/qwen3-embedding-8b", texts, onUsage),
    embedQuery: (texts, onUsage) => openRouterEmbed("qwen/qwen3-embedding-8b", texts.map(qwenInstructQuery), onUsage),
  },
  {
    id: "qwen/qwen3-embedding-4b-instruct-query",
    label: "Qwen3-Embedding-4B (instruct-prefixed query)",
    provider: "openrouter",
    pricePerMTokensUsd: 0.02,
    priceSource: "openrouter.ai/qwen/qwen3-embedding-4b (2026-06-03): $0.02 / 1M tokens",
    embed: (texts, onUsage) => openRouterEmbed("qwen/qwen3-embedding-4b", texts, onUsage),
    embedQuery: (texts, onUsage) => openRouterEmbed("qwen/qwen3-embedding-4b", texts.map(qwenInstructQuery), onUsage),
  },
];
