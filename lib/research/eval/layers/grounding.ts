/**
 * Grounding layer: fully implemented, this stream (QA Engineer, E05).
 *
 * Two human-free metrics per the ratified bench design (section 5, item 3):
 *
 *  1. ALCE-style citation precision/recall (Gao, Yen, Yu & Chen, EMNLP 2023):
 *     for each generated claim, LLM-verify entailment between the claim and
 *     EACH chunk it cited.
 *       - citationPrecision = (cited-chunk, claim) pairs where the chunk
 *         actually entails the claim, over all cited pairs.
 *       - citationRecall    = claims with at least one entailing citation,
 *         over all claims (a claim with zero citations counts as unsupported).
 *
 *  2. FActScore-style atomic-fact check (Min et al., EMNLP 2023): decompose
 *     the generated text into atomic facts, then LLM-verify each fact against
 *     the RAG-library corpus slice (not against the claim's own citations —
 *     this catches unsupported facts the generation didn't even cite).
 *       - factScore = supported atomic facts / total atomic facts.
 *
 * Reuses the judge.ts client pattern: GeminiClient.completeStructured, a Zod
 * schema per call shape, temperature 0, onUsage wired to real token counts.
 */
import { z } from "zod";
import { GeminiClient } from "../../../llm/gemini";
import type { UsageCallback } from "../../../llm/types";
import { llmCallCostUsd, startTimer } from "./pricing";
import { buildLayerReport, sumCost, zeroCost } from "./types";
import type { GroundingEvalItem, ItemCost, LayerItemResult, LayerReport, SourceChunkRef } from "./types";

const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

// --- ALCE-style entailment -------------------------------------------------

const EntailmentSchema = z.object({
  supported: z
    .boolean()
    .describe("true only if the passage directly supports/entails the claim, not merely related to it."),
  rationale: z.string().describe("One concise sentence."),
});

async function checkEntailment(
  client: GeminiClient,
  claimText: string,
  passageText: string,
  onUsage: UsageCallback,
): Promise<z.infer<typeof EntailmentSchema>> {
  return client.completeStructured({
    schema: EntailmentSchema,
    schemaName: "Entailment",
    system:
      "You are a strict fact-checking judge. Decide whether the PASSAGE directly " +
      "supports the CLAIM (entailment), not just topical relatedness. If the " +
      "passage is silent on the claim's specific assertion, or only tangentially " +
      "related, mark it unsupported.",
    temperature: 0,
    messages: [
      { role: "user", content: `CLAIM: ${claimText}\n\nPASSAGE: ${passageText}\n\nDoes the passage support the claim?` },
    ],
    onUsage,
  });
}

export interface CitationScore {
  citationPrecision: number;
  citationRecall: number;
  citationCount: number;
  supportedCitationCount: number;
  claimsWithSupportCount: number;
  claimCount: number;
}

async function scoreCitations(
  client: GeminiClient,
  claims: GroundingEvalItem["claims"],
  corpusById: Map<string, SourceChunkRef>,
  onUsage: UsageCallback,
): Promise<CitationScore> {
  let citationCount = 0;
  let supportedCitationCount = 0;
  let claimsWithSupportCount = 0;

  for (const claim of claims) {
    let claimSupported = false;
    for (const chunkId of claim.citedChunkIds) {
      citationCount++;
      const chunk = corpusById.get(chunkId);
      if (!chunk) continue; // a citation pointing at a nonexistent chunk is an unsupported citation
      const result = await checkEntailment(client, claim.text, chunk.text, onUsage);
      if (result.supported) {
        supportedCitationCount++;
        claimSupported = true;
      }
    }
    if (claimSupported) claimsWithSupportCount++;
  }

  return {
    citationPrecision: citationCount === 0 ? 0 : supportedCitationCount / citationCount,
    citationRecall: claims.length === 0 ? 0 : claimsWithSupportCount / claims.length,
    citationCount,
    supportedCitationCount,
    claimsWithSupportCount,
    claimCount: claims.length,
  };
}

// --- FActScore-style atomic-fact check -------------------------------------

const AtomicFactsSchema = z.object({
  facts: z
    .array(z.string())
    .describe("Short, independently verifiable atomic factual statements extracted from the text."),
});

async function decomposeAtomicFacts(
  client: GeminiClient,
  generatedText: string,
  onUsage: UsageCallback,
): Promise<string[]> {
  const result = await client.completeStructured({
    schema: AtomicFactsSchema,
    schemaName: "AtomicFacts",
    system:
      "Decompose the TEXT into a list of atomic factual statements: short, " +
      "self-contained claims that could each be independently true or false. " +
      "Skip opinions, instructions, and rhetorical filler. One fact per array entry.",
    temperature: 0,
    messages: [{ role: "user", content: `TEXT:\n${generatedText}` }],
    onUsage,
  });
  return result.facts;
}

const FactSupportSchema = z.object({
  supported: z.boolean().describe("true only if the corpus contains direct evidence for this fact."),
  rationale: z.string().describe("One concise sentence."),
});

async function checkFactAgainstCorpus(
  client: GeminiClient,
  fact: string,
  corpus: SourceChunkRef[],
  onUsage: UsageCallback,
): Promise<boolean> {
  const corpusBlock = corpus.map((c) => `[${c.id}] ${c.text}`).join("\n\n");
  const result = await client.completeStructured({
    schema: FactSupportSchema,
    schemaName: "FactSupport",
    system:
      "You are a fact-checker. Given a CORPUS of reference passages and one FACT, " +
      "decide whether the corpus directly supports the fact. If the corpus is " +
      "silent or only tangentially related, mark it unsupported.",
    temperature: 0,
    messages: [{ role: "user", content: `CORPUS:\n${corpusBlock}\n\nFACT: ${fact}` }],
    onUsage,
  });
  return result.supported;
}

export interface FactScoreResult {
  factScore: number;
  factCount: number;
  supportedFactCount: number;
}

async function scoreFactuality(
  client: GeminiClient,
  generatedText: string,
  corpus: SourceChunkRef[],
  onUsage: UsageCallback,
): Promise<FactScoreResult> {
  const facts = await decomposeAtomicFacts(client, generatedText, onUsage);
  let supportedFactCount = 0;
  for (const fact of facts) {
    const supported = await checkFactAgainstCorpus(client, fact, corpus, onUsage);
    if (supported) supportedFactCount++;
  }
  return {
    factScore: facts.length === 0 ? 0 : supportedFactCount / facts.length,
    factCount: facts.length,
    supportedFactCount,
  };
}

// --- Per-item entry point ----------------------------------------------------

export async function scoreGroundingItem(client: GeminiClient, item: GroundingEvalItem): Promise<LayerItemResult> {
  const stop = startTimer();
  let cost: ItemCost = zeroCost();
  let lastModel = DEFAULT_MODEL;
  const onUsage: UsageCallback = (usage, model) => {
    lastModel = model;
    cost = sumCost(cost, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: llmCallCostUsd(model, usage.inputTokens, usage.outputTokens),
      latencyMs: 0, // latency is measured once for the whole item below, not per call
      model,
    });
  };

  const corpusById = new Map(item.corpus.map((c) => [c.id, c]));
  const citation = await scoreCitations(client, item.claims, corpusById, onUsage);
  const factuality = await scoreFactuality(client, item.generatedText, item.corpus, onUsage);

  const latencyMs = stop();
  return {
    itemId: item.itemId,
    layer: "grounding",
    metrics: {
      citationPrecision: citation.citationPrecision,
      citationRecall: citation.citationRecall,
      citationCount: citation.citationCount,
      claimCount: citation.claimCount,
      factScore: factuality.factScore,
      factCount: factuality.factCount,
    },
    cost: { ...cost, latencyMs, model: lastModel },
  };
}

export async function computeGroundingLayer(client: GeminiClient, items: GroundingEvalItem[]): Promise<LayerReport> {
  const results: LayerItemResult[] = [];
  for (const item of items) {
    results.push(await scoreGroundingItem(client, item));
  }
  return buildLayerReport("grounding", results);
}
