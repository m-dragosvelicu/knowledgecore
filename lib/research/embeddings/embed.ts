/**
 * Production passage-embedding service. Reuses the ADR-9-ratified Gemini
 * embedding call exactly as proven by the D4 eval (gemini-embedding-001, dim
 * 3072, Cosine — see clients.ts and decisions/2026-06-03-adr9-web-search-
 * source-strategy). No params are re-derived; this only productionizes the
 * proven call into a reusable, dim-checked function for kc_passages ingestion.
 *
 * Cost telemetry (2026-08-08 cost-gap close): every batchEmbedContent request
 * is logged as one LlmCall row (purpose embed_ingest or embed_query per
 * caller — see EmbedPurpose below), best-effort like every other provider's
 * recordLlmCall. Token counts are an ESTIMATE: the Gemini Developer API's
 * embedContent response carries no usageMetadata for this (non-Vertex) key —
 * confirmed empirically by the D4 eval, see clients.ts's EmbedUsage doc
 * comment ("tokensEstimated... the per-text token count field... is
 * documented Vertex-API-only and was empirically absent when smoke-tested").
 * This module reuses the same ~4-chars/token heuristic already used
 * elsewhere in this codebase (see researchAgent.service.ts's
 * CHUNK_CHAR_BUDGET comment) rather than inventing a second one.
 */
import { GoogleGenAI } from "@google/genai";
import { prisma } from "@/lib/db";
import { computeCostMicroUsd } from "@/lib/llm/pricing";
import { getLlmTelemetryContext } from "@/lib/llm/telemetryContext";
import type { LlmCallPurpose } from "@prisma/client";

export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIM = 3072;

/** Which production call site this embed request serves — sets LlmCall.purpose. */
export type EmbedPurpose = Extract<LlmCallPurpose, "embed_ingest" | "embed_query">;

// Gemini API hard limit on batchEmbedContents (undocumented in SDK types,
// confirmed against the live API: "at most 100 requests can be in one batch").
const MAX_BATCH_SIZE = 100;

// Same heuristic as researchAgent.service.ts's CHUNK_CHAR_BUDGET comment
// ("~512 tokens at ~4 chars/token"); documented as an estimate above, not
// exposed as configurable since it only ever feeds cost telemetry, never a
// correctness-sensitive path.
const CHARS_PER_TOKEN_ESTIMATE = 4;

function estimateInputTokens(texts: string[]): number {
  const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
  return Math.ceil(totalChars / CHARS_PER_TOKEN_ESTIMATE);
}

/** Best-effort per-batch telemetry; a logging failure must never break embedding. */
async function recordEmbedCall(args: {
  purpose: EmbedPurpose;
  inputTokens: number;
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
}): Promise<void> {
  try {
    const ctx = getLlmTelemetryContext();
    await prisma.llmCall.create({
      data: {
        purpose: args.purpose,
        model: EMBEDDING_MODEL,
        inputTokens: args.inputTokens,
        outputTokens: 0,
        costMicroUsd: computeCostMicroUsd(EMBEDDING_MODEL, args.inputTokens, 0),
        latencyMs: args.latencyMs,
        success: args.success,
        errorMessage: args.errorMessage,
        userId: ctx?.userId ?? null,
        intentId: ctx?.intentId ?? null,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[llm-telemetry] failed to persist ${args.purpose} row: ${(err as Error).message}`,
    );
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __geminiEmbed: GoogleGenAI | undefined;
}

function client(): GoogleGenAI {
  const key = process.env.GOOGLE_GENAI_API_KEY;
  if (!key) throw new Error("GOOGLE_GENAI_API_KEY is not set");
  const c = globalThis.__geminiEmbed ?? new GoogleGenAI({ apiKey: key });
  if (process.env.NODE_ENV !== "production") globalThis.__geminiEmbed = c;
  return c;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Embed passages with gemini-embedding-001 at dim 3072, in batches of up to
 * MAX_BATCH_SIZE. Order is preserved per the Gemini API's documented guarantee
 * ("embeddings for each request, in the same order as provided"). Throws if any
 * vector isn't EMBEDDING_DIM so drift never lands mismatched vectors in the
 * dim-locked collection.
 *
 * `opts.purpose` defaults to "embed_ingest" (the more common call site,
 * bundle ingestion); lib/library/learnerSearch.ts passes "embed_query"
 * explicitly for its one-text query embed. One LlmCall row is logged per
 * underlying batchEmbedContent request (the actual billed unit), success or
 * failure, before any error is (re)thrown.
 */
export async function embedPassages(
  texts: string[],
  opts?: { purpose?: EmbedPurpose },
): Promise<number[][]> {
  const purpose = opts?.purpose ?? "embed_ingest";
  const gemini = client();
  const out: number[][] = [];
  for (const batch of chunk(texts, MAX_BATCH_SIZE)) {
    const startedAt = Date.now();
    try {
      const r = await gemini.models.embedContent({ model: EMBEDDING_MODEL, contents: batch });
      const embeddings = r.embeddings;
      if (!embeddings || embeddings.length !== batch.length) {
        throw new Error(
          `Gemini embedContent returned ${embeddings?.length ?? 0} embeddings for a batch of ${batch.length}`,
        );
      }
      for (const e of embeddings) {
        const values = e.values;
        if (!values) throw new Error(`Gemini embedContent returned no values for ${EMBEDDING_MODEL}`);
        if (values.length !== EMBEDDING_DIM) {
          throw new Error(
            `Embedding dim mismatch: got ${values.length}, expected ${EMBEDDING_DIM} (ADR 9 lock)`,
          );
        }
        out.push(values);
      }
      await recordEmbedCall({
        purpose,
        inputTokens: estimateInputTokens(batch),
        latencyMs: Date.now() - startedAt,
        success: true,
        errorMessage: null,
      });
    } catch (err) {
      await recordEmbedCall({
        purpose,
        inputTokens: estimateInputTokens(batch),
        latencyMs: Date.now() - startedAt,
        success: false,
        errorMessage: (err as Error).message,
      });
      throw err;
    }
  }
  return out;
}
