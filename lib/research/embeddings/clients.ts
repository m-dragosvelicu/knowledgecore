/**
 * Embedding client adapters for the D4 eval: Gemini Embedding
 * (gemini-embedding-001) via @google/genai, and Qwen3-Embedding-8B/-4B via
 * OpenRouter's OpenAI-compatible /embeddings. Each records its live vector
 * dimension and per-1M-token price (USD, provider's public pricing at eval
 * time), and exposes a batched embed().
 */
import { GoogleGenAI } from "@google/genai";

export interface EmbedModel {
  id: string;
  label: string;
  provider: "gemini" | "openrouter";
  /** USD per 1M input tokens, from the provider's public pricing (cited in results). */
  pricePerMTokensUsd: number;
  priceSource: string;
  embed(texts: string[]): Promise<number[][]>;
}

const gemini = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY });

/** Gemini embeds one content per call in this SDK version; map sequentially. */
async function geminiEmbed(modelId: string, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (const t of texts) {
    const r = await gemini.models.embedContent({ model: modelId, contents: t });
    // SDK shape: { embeddings: [{ values: number[] }] }
    const values =
      (r as { embeddings?: { values?: number[] }[] }).embeddings?.[0]?.values ??
      (r as { embedding?: { values?: number[] } }).embedding?.values;
    if (!values) throw new Error(`Gemini embedContent returned no values for ${modelId}`);
    out.push(values);
  }
  return out;
}

async function openRouterEmbed(modelId: string, texts: string[]): Promise<number[][]> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelId, input: texts }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter embeddings failed (${modelId}): ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data?: { embedding: number[]; index: number }[] };
  const rows = (data.data ?? []).slice().sort((a, b) => a.index - b.index);
  return rows.map((r) => r.embedding);
}

export const EMBED_MODELS: EmbedModel[] = [
  {
    id: "gemini-embedding-001",
    label: "Gemini Embedding (gemini-embedding-001)",
    provider: "gemini",
    pricePerMTokensUsd: 0.15,
    priceSource: "ai.google.dev/gemini-api/docs/pricing (paid tier, 2026-06-03): $0.15 / 1M input tokens",
    embed: (texts) => geminiEmbed("gemini-embedding-001", texts),
  },
  {
    id: "qwen/qwen3-embedding-8b",
    label: "Qwen3-Embedding-8B (OpenRouter)",
    provider: "openrouter",
    pricePerMTokensUsd: 0.01,
    priceSource: "openrouter.ai/qwen/qwen3-embedding-8b (2026-06-03): $0.01 / 1M tokens",
    embed: (texts) => openRouterEmbed("qwen/qwen3-embedding-8b", texts),
  },
  {
    id: "qwen/qwen3-embedding-4b",
    label: "Qwen3-Embedding-4B (OpenRouter)",
    provider: "openrouter",
    pricePerMTokensUsd: 0.02,
    priceSource: "openrouter.ai/qwen/qwen3-embedding-4b (2026-06-03): $0.02 / 1M tokens",
    embed: (texts) => openRouterEmbed("qwen/qwen3-embedding-4b", texts),
  },
  // NOTE: Qwen3-Embedding-0.6B is intentionally absent. The canonical slug
  // qwen/qwen3-embedding-0.6b returns HTTP 404 "No endpoints found" on
  // OpenRouter's embeddings endpoint (verified 2026-06-03). Recorded as a gap in
  // RESULTS-SUMMARY.md rather than faked.
];
