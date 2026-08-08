/**
 * Surface layer: fully implemented, this stream (QA Engineer, E05).
 *
 * Two human-free metrics per the ratified bench design (section 5, item 4 of
 * the mapping table):
 *
 *  1. BERTScore-equivalent, embedding greedy-match (Zhang, Kishore, Wu,
 *     Weinberger & Artzi, ICLR 2020). Canonical BERTScore uses contextual
 *     token embeddings from a fixed reference model (roberta-large by
 *     default); this stack has no local BERT model, so per the CEO-ratified
 *     report's explicit allowance ("BERTScore, or embedding-similarity
 *     equivalent given our stack"), this reimplements BERTScore's actual
 *     ALGORITHM (greedy best-match cosine similarity, precision/recall/F1)
 *     at sentence granularity using the project's own embedding model
 *     (gemini-embedding-001, reused from lib/research/embeddings/clients.ts)
 *     instead of token-level BERT embeddings. Needs a reference text — see
 *     the mapping table's caveat: a stronger-model silver reference is a
 *     known-weak substitute for a gold reference.
 *
 *  2. Flesch-Kincaid grade level (Kincaid, Fishburne, Rogers & Chissom,
 *     1975). Fully deterministic, no model call, zero cost — implemented
 *     directly per the task brief, no external formula library.
 */
import { EMBED_MODELS } from "../../embeddings/clients";
import type { EmbedUsage } from "../../embeddings/clients";
import { embedCallCostUsd, startTimer } from "./pricing";
import { buildLayerReport, sumCost, zeroCost } from "./types";
import type { ItemCost, LayerItemResult, LayerReport, SurfaceEvalItem } from "./types";

// Reuse the same embed model the D4 ingestion bench already prices and uses
// in production (dim 3072, ADR-locked). Not the embedding-eval's full model
// roster on purpose: the surface layer needs one consistent metric space, not
// a model comparison.
const SURFACE_EMBED_MODEL = EMBED_MODELS.find((m) => m.id === "gemini-embedding-001");
if (!SURFACE_EMBED_MODEL) {
  throw new Error("surface.ts: gemini-embedding-001 not found in EMBED_MODELS");
}

function splitSentences(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.length > 0 ? sentences : [text.trim()].filter(Boolean);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface BertScoreLikeResult {
  precision: number;
  recall: number;
  f1: number;
  candidateSentenceCount: number;
  referenceSentenceCount: number;
}

/** Greedy best-match cosine similarity, exactly BERTScore's own matching
 *  algorithm, over sentence-level embeddings instead of token-level ones. */
function greedyMatchScore(candidateEmbeddings: number[][], referenceEmbeddings: number[][]): BertScoreLikeResult {
  const precisionTerms = candidateEmbeddings.map((c) =>
    Math.max(...referenceEmbeddings.map((r) => cosineSimilarity(c, r))),
  );
  const recallTerms = referenceEmbeddings.map((r) =>
    Math.max(...candidateEmbeddings.map((c) => cosineSimilarity(c, r))),
  );
  const precision = precisionTerms.reduce((a, b) => a + b, 0) / precisionTerms.length;
  const recall = recallTerms.reduce((a, b) => a + b, 0) / recallTerms.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    precision,
    recall,
    f1,
    candidateSentenceCount: candidateEmbeddings.length,
    referenceSentenceCount: referenceEmbeddings.length,
  };
}

async function scoreBertScoreLike(
  candidateText: string,
  referenceText: string,
): Promise<{ result: BertScoreLikeResult; cost: ItemCost }> {
  const stop = startTimer();
  const candidateSentences = splitSentences(candidateText);
  const referenceSentences = splitSentences(referenceText);

  let cost: ItemCost = zeroCost();
  const onUsage = (usage: EmbedUsage) => {
    const costUsd = usage.costUsd ?? embedCallCostUsd(SURFACE_EMBED_MODEL!.id, usage.tokens);
    cost = sumCost(cost, {
      inputTokens: usage.tokens,
      outputTokens: 0,
      costUsd,
      latencyMs: 0,
      model: SURFACE_EMBED_MODEL!.id,
    });
  };

  const [candidateEmbeddings, referenceEmbeddings] = await Promise.all([
    SURFACE_EMBED_MODEL!.embed(candidateSentences, onUsage),
    SURFACE_EMBED_MODEL!.embed(referenceSentences, onUsage),
  ]);

  const result = greedyMatchScore(candidateEmbeddings, referenceEmbeddings);
  return { result, cost: { ...cost, latencyMs: stop(), model: SURFACE_EMBED_MODEL!.id } };
}

// --- Flesch-Kincaid grade level (deterministic) -----------------------------

const VOWEL_GROUPS = /[aeiouy]+/g;

/** Heuristic syllable counter (standard Flesch-Kincaid implementation
 *  approach: count vowel groups, drop a silent trailing "e", floor at 1). */
function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  const matches = w.match(VOWEL_GROUPS) ?? [];
  let count = matches.length;
  if (w.endsWith("e") && !w.endsWith("le") && count > 1) count--;
  return Math.max(count, 1);
}

export interface FleschKincaidResult {
  gradeLevel: number;
  wordCount: number;
  sentenceCount: number;
  syllableCount: number;
}

/** Kincaid, Fishburne, Rogers & Chissom (1975), Research Branch Report 8-75:
 *  grade = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59 */
export function fleschKincaidGradeLevel(text: string): FleschKincaidResult {
  const sentences = splitSentences(text);
  const words = text.split(/\s+/).map((w) => w.trim()).filter(Boolean);
  const syllableCount = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const sentenceCount = Math.max(sentences.length, 1);
  const wordCount = Math.max(words.length, 1);
  const gradeLevel =
    0.39 * (wordCount / sentenceCount) + 11.8 * (syllableCount / wordCount) - 15.59;
  return { gradeLevel, wordCount, sentenceCount, syllableCount };
}

// --- Per-item entry point ----------------------------------------------------

export async function scoreSurfaceItem(item: SurfaceEvalItem): Promise<LayerItemResult> {
  const stop = startTimer();
  const fk = fleschKincaidGradeLevel(item.generatedText);

  let cost: ItemCost = zeroCost();
  const metrics: Record<string, number | string | boolean | null> = {
    fleschKincaidGradeLevel: fk.gradeLevel,
    wordCount: fk.wordCount,
    sentenceCount: fk.sentenceCount,
  };

  if (item.referenceText && item.referenceText.trim().length > 0) {
    const { result, cost: embedCost } = await scoreBertScoreLike(item.generatedText, item.referenceText);
    cost = sumCost(cost, embedCost);
    metrics.bertScoreLikePrecision = result.precision;
    metrics.bertScoreLikeRecall = result.recall;
    metrics.bertScoreLikeF1 = result.f1;
  }

  return {
    itemId: item.itemId,
    layer: "surface",
    metrics,
    cost: { ...cost, latencyMs: stop() },
    notes: item.referenceText ? undefined : "no referenceText supplied; BERTScore-equivalent skipped",
  };
}

export async function computeSurfaceLayer(items: SurfaceEvalItem[]): Promise<LayerReport> {
  const results: LayerItemResult[] = [];
  for (const item of items) {
    results.push(await scoreSurfaceItem(item));
  }
  return buildLayerReport("surface", results);
}
