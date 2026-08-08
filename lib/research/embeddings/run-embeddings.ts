/**
 * L2 ingestion bench — embedding-model eval (D4, CEO plan §5). Reuses the
 * extracted clean text from run-search.ts; per topic, chunks the extracted
 * sources, has the judge label ground-truth relevant chunks per query, then
 * for each candidate model: embeds chunks + queries, retrieves top-k by
 * cosine, computes Recall@5/MRR/nDCG@10, and ingests chunk vectors into Qdrant
 * (Phase-2 path).
 *
 * Prereq: run-search.ts has written out/extractions.json + out/raw-search.json.
 * Run: bun run lib/research/embeddings/run-embeddings.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { QUERIES, TOPICS } from "../eval/queries";
import type { EngineResult, Extraction } from "../eval/types";
import { GeminiClient } from "../../llm/gemini";
import { labelRelevantChunks } from "../eval/judge";
import { chunkText, cosine, CHUNK_SCHEME, type Chunk } from "./chunk";
import { EMBED_MODELS, type EmbedModel, type EmbedUsage, type EmbedUsageCallback } from "./clients";
import { ingestChunks } from "./ingest";
import { computeCostMicroUsd } from "../../llm/pricing";

// EVAL_OUT_DIR mirrors run-search.ts: lets a re-run read/write a fresh
// directory instead of the archived out/ (thesis results, read-only).
// Defaults to the original out/ path when unset.
const OUT_DIR = process.env.EVAL_OUT_DIR
  ? resolve(process.cwd(), process.env.EVAL_OUT_DIR)
  : join(fileURLToPath(new URL(".", import.meta.url)), "..", "eval", "out");

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function recallAt(retrievedIds: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return NaN;
  const hit = retrievedIds.slice(0, k).filter((id) => relevant.has(id)).length;
  return hit / Math.min(relevant.size, k);
}

function mrr(retrievedIds: string[], relevant: Set<string>): number {
  for (let i = 0; i < retrievedIds.length; i++) {
    if (relevant.has(retrievedIds[i])) return 1 / (i + 1);
  }
  return 0;
}

function ndcgAt(retrievedIds: string[], relevant: Set<string>, k: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(k, retrievedIds.length); i++) {
    if (relevant.has(retrievedIds[i])) dcg += 1 / Math.log2(i + 2);
  }
  let idcg = 0;
  const ideal = Math.min(relevant.size, k);
  for (let i = 0; i < ideal; i++) idcg += 1 / Math.log2(i + 2);
  return idcg > 0 ? dcg / idcg : NaN;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const extractions = JSON.parse(readFileSync(join(OUT_DIR, "extractions.json"), "utf8")) as Record<string, Extraction>;
  const rawSearch = JSON.parse(readFileSync(join(OUT_DIR, "raw-search.json"), "utf8")) as EngineResult[];
  const client = new GeminiClient();

  // 1. Build a per-topic URL set from the search hits, then chunk the extracted
  //    text. Cap chunks per topic to keep the corpus bench-sized + cheap.
  const byQuery = new Map<string, string>(QUERIES.map((q) => [q.query, q.topic]));
  const topicUrls: Record<string, Set<string>> = Object.fromEntries(TOPICS.map((t) => [t, new Set<string>()]));
  for (const r of rawSearch) {
    const topic = byQuery.get(r.query);
    if (!topic) continue;
    for (const h of r.hits) topicUrls[topic].add(h.url);
  }

  const MAX_CHUNKS_PER_TOPIC = 60;
  const topicChunks: Record<string, Chunk[]> = {};
  for (const topic of TOPICS) {
    const chunks: Chunk[] = [];
    let srcIdx = 0;
    for (const url of topicUrls[topic]) {
      const ex = extractions[url];
      if (!ex?.ok || !ex.text) continue;
      const prefix = `${topic.replace(/\s+/g, "")}-s${srcIdx++}`;
      // Trim very long pages so one source can't dominate the corpus.
      const trimmed = ex.text.slice(0, 12000);
      for (const c of chunkText(url, trimmed, prefix)) {
        chunks.push(c);
        if (chunks.length >= MAX_CHUNKS_PER_TOPIC) break;
      }
      if (chunks.length >= MAX_CHUNKS_PER_TOPIC) break;
    }
    topicChunks[topic] = chunks;
    console.log(`[chunk] ${topic}: ${chunks.length} chunks from ${topicUrls[topic].size} urls`);
  }

  // 2. Ground truth: judge labels relevant chunks per query (within its topic).
  console.log("[ground-truth] labelling relevant chunks per query...");
  const groundTruth: Record<string, Set<string>> = {};
  // Step 6 telemetry: mirrors run-search.ts's judgeUsage block.
  let judgeCalls = 0;
  let judgeInputTokens = 0;
  let judgeOutputTokens = 0;
  const judgeLatencies: number[] = [];
  const onJudgeUsage = (usage: { inputTokens: number; outputTokens: number }) => {
    judgeCalls++;
    judgeInputTokens += usage.inputTokens;
    judgeOutputTokens += usage.outputTokens;
  };
  for (const q of QUERIES) {
    const chunks = topicChunks[q.topic];
    if (!chunks.length) {
      groundTruth[q.id] = new Set();
      continue;
    }
    const tJudge = Date.now();
    try {
      const labelled = await labelRelevantChunks(
        client,
        {
          level: q.level,
          query: q.query,
          chunks: chunks.map((c) => ({ id: c.id, text: c.text })),
        },
        onJudgeUsage,
      );
      judgeLatencies.push(Date.now() - tJudge);
      groundTruth[q.id] = new Set(labelled.relevantChunkIds.filter((id) => chunks.some((c) => c.id === id)));
    } catch (e) {
      console.log(`  ! label failed ${q.id}: ${(e as Error).message}`);
      groundTruth[q.id] = new Set();
    }
    process.stdout.write(".");
  }
  console.log("");
  const labelledCount = Object.values(groundTruth).filter((s) => s.size > 0).length;
  console.log(`[ground-truth] ${labelledCount}/${QUERIES.length} queries have >=1 labelled relevant chunk`);

  // 3. Per model: embed chunks + queries, retrieve, score, ingest into Qdrant.
  const allChunks: Chunk[] = TOPICS.flatMap((t) => topicChunks[t]);
  const modelResults: Record<string, unknown> = {};
  const ingestSummary: { collection: string; dim: number; pointCount: number; model: string }[] = [];

  for (const model of EMBED_MODELS) {
    console.log(`\n[model] ${model.label} — embedding ${allChunks.length} chunks...`);
    const tEmbedStart = Date.now();
    // Step 6 telemetry: accumulate tokens/cost across both the chunk-embed
    // batches and the per-query embed calls for this model.
    const usage: EmbedUsage[] = [];
    const onEmbedUsage = (u: EmbedUsage) => usage.push(u);
    let chunkVecs: number[][];
    try {
      chunkVecs = await embedInBatches(model, allChunks.map((c) => c.text), onEmbedUsage);
    } catch (e) {
      console.log(`  ! ${model.id} chunk embedding failed: ${(e as Error).message}`);
      modelResults[model.id] = { error: (e as Error).message };
      continue;
    }
    const chunkEmbedMs = Date.now() - tEmbedStart;
    const dim = chunkVecs[0]?.length ?? 0;
    const vecById = new Map<string, number[]>(allChunks.map((c, i) => [c.id, chunkVecs[i]]));

    const queryLatencies: number[] = [];
    const perQuery: { queryId: string; recall5: number; mrr: number; ndcg10: number; relevant: number }[] = [];

    for (const q of QUERIES) {
      const relevant = groundTruth[q.id];
      const candidateIds = topicChunks[q.topic].map((c) => c.id); // retrieve within-topic
      if (relevant.size === 0 || candidateIds.length === 0) continue;
      const tq = Date.now();
      let qvec: number[];
      try {
        // Query-side: use the instruction-prefixed embedder when the model
        // variant defines one (embedQuery), else fall back to the bare
        // embed() -- keeps every pre-existing model's behaviour unchanged.
        const embedQueryFn = model.embedQuery ?? model.embed;
        qvec = (await embedQueryFn([q.query], onEmbedUsage))[0];
      } catch (e) {
        console.log(`  ! ${model.id} query embed failed ${q.id}: ${(e as Error).message}`);
        continue;
      }
      queryLatencies.push(Date.now() - tq);
      const ranked = candidateIds
        .map((id) => ({ id, score: cosine(qvec, vecById.get(id)!) }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.id);
      perQuery.push({
        queryId: q.id,
        recall5: recallAt(ranked, relevant, 5),
        mrr: mrr(ranked, relevant),
        ndcg10: ndcgAt(ranked, relevant, 10),
        relevant: relevant.size,
      });
    }

    const recall5 = mean(perQuery.map((p) => p.recall5).filter((x) => !Number.isNaN(x)));
    const mrrAvg = mean(perQuery.map((p) => p.mrr));
    const ndcg10 = mean(perQuery.map((p) => p.ndcg10).filter((x) => !Number.isNaN(x)));

    // Qdrant ingestion (Phase-2 path).
    let ingest;
    try {
      ingest = await ingestChunks(model.id, allChunks, chunkVecs);
      ingestSummary.push({ ...ingest, model: model.id });
      console.log(`  ingested ${ingest.pointCount} points into ${ingest.collection} (dim ${ingest.dim})`);
    } catch (e) {
      console.log(`  ! ${model.id} Qdrant ingest failed: ${(e as Error).message}`);
    }

    // Step 6: fold per-call usage into a model-level total. Prefer the sum of
    // real provider-reported costUsd (OpenRouter); fall back to
    // tokens * pricePerMTokensUsd when a provider doesn't report cost
    // directly (Gemini -- tokens there are also an estimate, see clients.ts).
    const totalTokens = usage.reduce((s, u) => s + u.tokens, 0);
    const reportedCost = usage.reduce((s, u) => s + (u.costUsd ?? 0), 0);
    const hasReportedCost = usage.some((u) => u.costUsd != null);
    const tokensEstimated = usage.some((u) => u.tokensEstimated);
    const estimatedUsdFromTokens = (totalTokens / 1_000_000) * model.pricePerMTokensUsd;

    modelResults[model.id] = {
      label: model.label,
      dim,
      pricePerMTokensUsd: model.pricePerMTokensUsd,
      priceSource: model.priceSource,
      recallAt5: Number(recall5.toFixed(4)),
      mrr: Number(mrrAvg.toFixed(4)),
      ndcgAt10: Number(ndcg10.toFixed(4)),
      queriesScored: perQuery.length,
      chunkEmbedMs,
      meanQueryEmbedMs: Math.round(mean(queryLatencies)),
      qdrant: ingest ? { collection: ingest.collection, pointCount: ingest.pointCount } : null,
      usage: {
        totalTokens,
        tokensEstimated,
        usd: Number((hasReportedCost ? reportedCost : estimatedUsdFromTokens).toFixed(6)),
        usdSource: hasReportedCost ? "provider-reported (OpenRouter usage.cost)" : "estimated: tokens * pricePerMTokensUsd",
      },
      perQuery,
    };
    console.log(`  ${model.label}: R@5=${recall5.toFixed(3)} MRR=${mrrAvg.toFixed(3)} nDCG@10=${ndcg10.toFixed(3)} (n=${perQuery.length})`);
  }

  // Step 6: ground-truth-labelling judge cost table, same shape/pricing
  // source as run-search.ts's judgeUsage.
  const judgeModelId = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
  const judgeCostUsd = computeCostMicroUsd(judgeModelId, judgeInputTokens, judgeOutputTokens) / 1_000_000;
  const judgeUsage = {
    calls: judgeCalls,
    totalInputTokens: judgeInputTokens,
    totalOutputTokens: judgeOutputTokens,
    totalUsd: Number(judgeCostUsd.toFixed(6)),
    meanLatencyMs: Math.round(mean(judgeLatencies)),
    note: "USD via lib/llm/pricing.ts PRICE_TABLE (gemini-3.5-flash: $0.30/1M in, $2.50/1M out).",
  };

  const bundle = {
    generatedAt: new Date().toISOString(),
    chunkScheme: CHUNK_SCHEME,
    totalChunks: allChunks.length,
    chunksPerTopic: Object.fromEntries(TOPICS.map((t) => [t, topicChunks[t].length])),
    groundTruthLabelledQueries: labelledCount,
    judgeModel: judgeModelId,
    judgeUsage,
    note:
      "Qwen3-Embedding-0.6B excluded: OpenRouter returns HTTP 404 'no endpoints' for qwen/qwen3-embedding-0.6b (verified 2026-06-03). Instruction-prefixed Qwen query variants added 2026-07-30 (see clients.ts QWEN_INSTRUCT_QUERY_TEMPLATE); documents stay bare per Qwen3-Embedding convention.",
    models: modelResults,
    qdrantIngest: ingestSummary,
  };
  writeFileSync(join(OUT_DIR, "embedding-results.json"), JSON.stringify(bundle, null, 2));
  console.log("\nWrote embedding-results.json");
}

/** OpenRouter accepts arrays; Gemini is sequential. Batch OpenRouter at 64. */
async function embedInBatches(model: EmbedModel, texts: string[], onUsage?: EmbedUsageCallback): Promise<number[][]> {
  if (model.provider === "gemini") return model.embed(texts, onUsage); // adapter loops internally
  const BATCH = 64;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const part = await model.embed(texts.slice(i, i + BATCH), onUsage);
    out.push(...part);
  }
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
