/**
 * LLM-as-judge scoring for the search rubric (CEO plan §4).
 * Relevance/level and credibility are scored 0-2 by Gemini (completeStructured).
 * Groundability is deterministic (computed in score-search, not here).
 * Open PageRank is folded into the credibility signal downstream.
 */
import { z } from "zod";
import { GeminiClient } from "../../llm/gemini";
import type { UsageCallback } from "../../llm/types";

export const RubricScoreSchema = z.object({
  relevance: z
    .number()
    .describe(
      "0-2. Relevance/level for the learner. 0 = off-topic or wrong level (hyper-academic or junk for an intro). 1 = related but partial. 2 = directly useful at the learner's depth.",
    ),
  credibility: z
    .number()
    .describe(
      "0-2. 0 = SEO spam / forum / unattributable. 1 = acceptable source. 2 = authoritative (educational, encyclopedic, expert).",
    ),
  rationale: z.string().describe("One concise sentence justifying both scores."),
});

export type RubricScore = z.infer<typeof RubricScoreSchema>;

const SYSTEM =
  "You are an expert curriculum evaluator scoring web search results for a learner-facing AI tutor. " +
  "Score strictly on the provided 0-2 rubric. A result is judged at the stated learner level (intro or intermediate). " +
  "Do not reward credentials alone (a paywalled hyper-academic paper is wrong-level for an intro learner). " +
  "Return only the structured score.";

export async function scoreResult(
  client: GeminiClient,
  args: {
    topic: string;
    level: string;
    query: string;
    title: string;
    url: string;
    snippet: string;
    extractPreview: string;
  },
  // Optional cost/token telemetry sink for the journal-article cost table
  // (Step 6). Additive: omitted callers behave exactly as before.
  onUsage?: UsageCallback,
): Promise<RubricScore> {
  const user = [
    `TOPIC: ${args.topic}`,
    `LEARNER LEVEL: ${args.level}`,
    `LEARNER QUERY: ${args.query}`,
    "",
    "SEARCH RESULT:",
    `Title: ${args.title}`,
    `URL: ${args.url}`,
    `Snippet: ${args.snippet}`,
    args.extractPreview
      ? `Extracted text (first ~800 chars): ${args.extractPreview.slice(0, 800)}`
      : "Extracted text: (extraction failed)",
    "",
    "Score relevance/level (0-2) and credibility (0-2) per the rubric.",
  ].join("\n");

  return client.completeStructured({
    schema: RubricScoreSchema,
    schemaName: "RubricScore",
    system: SYSTEM,
    temperature: 0,
    messages: [{ role: "user", content: user }],
    onUsage,
  });
}

/**
 * Per-query relevant-chunk labelling for the embedding eval ground truth
 * (CEO plan §5): the judge marks which chunks actually answer the query at the
 * stated level.
 */
export const RelevantChunksSchema = z.object({
  relevantChunkIds: z
    .array(z.string())
    .describe("IDs of the chunks that DIRECTLY answer the query at the stated learner level. Empty if none do."),
});

export type RelevantChunks = z.infer<typeof RelevantChunksSchema>;

export async function labelRelevantChunks(
  client: GeminiClient,
  args: {
    level: string;
    query: string;
    chunks: { id: string; text: string }[];
  },
  onUsage?: UsageCallback,
): Promise<RelevantChunks> {
  const candidateBlock = args.chunks
    .map((c) => `[${c.id}] ${c.text.slice(0, 350).replace(/\s+/g, " ")}`)
    .join("\n\n");
  const user = [
    `LEARNER LEVEL: ${args.level}`,
    `LEARNER QUERY: ${args.query}`,
    "",
    "CANDIDATE CHUNKS:",
    candidateBlock,
    "",
    "Return the IDs of chunks that DIRECTLY answer the query at the stated level. Be selective.",
  ].join("\n");

  return client.completeStructured({
    schema: RelevantChunksSchema,
    schemaName: "RelevantChunks",
    system:
      "You label which text chunks answer a learner's query, to build retrieval ground truth. Be precise: include only chunks that genuinely answer it at the stated level.",
    temperature: 0,
    messages: [{ role: "user", content: user }],
    onUsage,
  });
}
