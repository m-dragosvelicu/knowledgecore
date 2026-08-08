/**
 * Smoke test for the qrels pipeline. Proves the modules load and one query's
 * qrels + metrics pipeline works end-to-end, WITHOUT running the full 78-query
 * bench (API cost — that is the harness's job, not this task's). n=2: a
 * synthetic 2-chunk corpus for 1 query, one live Gemini judge call.
 *
 * Run: bun run lib/research/eval/qrels/smoke.ts
 * Requires GOOGLE_GENAI_API_KEY (same key run-search.ts/run-embeddings.ts use).
 */
import { GeminiClient } from "../../../llm/gemini";
import { QUERIES_V2 } from "../queries";
import { buildCorpusFromTexts } from "./corpus";
import { buildQrelsForQuery } from "./build";
import { mrr, ndcgAt, recallAt } from "./metrics";

async function main() {
  // 1. Modules load: importing the above already proves this — if any of
  //    queries.ts/corpus.ts/build.ts/metrics.ts/judge.ts fails to parse or
  //    has a bad import path, `bun run` fails before main() even starts.
  const query = QUERIES_V2.find((q) => q.id === "photo-1");
  if (!query) throw new Error("smoke: photo-1 not found in QUERIES_V2");

  // 2. n=2: a tiny synthetic corpus, one clearly relevant doc, one clearly not.
  // Each doc needs to clear chunk.ts's trailing-flush floor (> OVERLAP_WORDS+5
  // = 53 words) to produce a chunk at all, hence the longer paragraphs below.
  const chunks = buildCorpusFromTexts("photosynthesis", [
    {
      url: "https://smoke-test.invalid/relevant",
      text: "Photosynthesis is the process green plants, algae, and some bacteria use to convert sunlight, water, and carbon dioxide into glucose and oxygen. It happens mainly in the chloroplasts of leaf cells, where chlorophyll absorbs light energy. The light-dependent reactions produce ATP and NADH, which then power the Calvin cycle to fix carbon dioxide into sugar.",
    },
    {
      url: "https://smoke-test.invalid/irrelevant",
      text: "The Krebs cycle, also called the citric acid cycle, is a series of chemical reactions in the mitochondria of animal and plant cells that release stored energy from carbohydrates, fats, and proteins as usable ATP. It occurs during cellular respiration, not photosynthesis, and consumes oxygen rather than producing it, releasing carbon dioxide as a byproduct instead of consuming it.",
    },
  ]);
  if (chunks.length !== 2) throw new Error(`smoke: expected 2 chunks from 2 one-paragraph docs, got ${chunks.length}`);
  console.log(`[smoke] corpus: ${chunks.length} chunks (${chunks.map((c) => c.id).join(", ")})`);

  // 3. Live judge call: label which of the 2 chunks answers the query.
  const client = new GeminiClient();
  const entry = await buildQrelsForQuery(client, query, chunks);
  if (entry.error) throw new Error(`smoke: judge call failed: ${entry.error}`);
  console.log(`[smoke] qrels entry: relevant=${JSON.stringify(entry.relevantChunkIds)} candidates=${JSON.stringify(entry.candidateChunkIds)}`);

  const relevantSet = new Set(entry.relevantChunkIds);
  if (relevantSet.size === 0) {
    throw new Error("smoke: judge labelled zero chunks relevant on an unambiguous 2-doc corpus — pipeline ran but ground truth is empty, treat as FAIL for this smoke check");
  }

  // 4. Metrics pipeline: run the same functions the retrieval-layer bench
  //    will use, against a trivial "perfect" ranking (candidate order as-is)
  //    to prove metrics.ts itself computes without error.
  const retrievedIds = entry.candidateChunkIds;
  const r = recallAt(retrievedIds, relevantSet, 2);
  const m = mrr(retrievedIds, relevantSet);
  const n = ndcgAt(retrievedIds, relevantSet, 2);
  console.log(`[smoke] metrics on candidate-order ranking: recall@2=${r.toFixed(3)} mrr=${m.toFixed(3)} ndcg@2=${n.toFixed(3)}`);

  if (Number.isNaN(r) || Number.isNaN(n)) throw new Error("smoke: recall/ndcg returned NaN unexpectedly");

  console.log("[smoke] PASS: queries.ts, corpus.ts, build.ts, judge.ts (labelRelevantChunks), and metrics.ts all load and run end-to-end.");
}

main().catch((e) => {
  console.error("[smoke] FAIL:", e);
  process.exit(1);
});
