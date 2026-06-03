/**
 * Builds RESULTS-SUMMARY.md from search-results.json + embedding-results.json.
 * Every number is read straight from the JSON bundles (no hand-entered values),
 * so the summary is traceable. Applies the §6 decision rules to name the winners.
 *
 * Run AFTER run-search.ts and run-embeddings.ts.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "out");

interface PerEngine {
  engine: string;
  overallUsefulPct: number;
  band: string;
  meanRelevance: number;
  meanCredibility: number;
  meanGroundability: number;
  meanLatencyMs: number;
  scoredResults: number;
  perTopic: Record<string, { usefulPct: number; band: string; n: number }>;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function main() {
  const search = JSON.parse(readFileSync(join(OUT_DIR, "search-results.json"), "utf8")) as {
    generatedAt: string;
    judgeModel: string;
    queries: number;
    extractionSuccess: string;
    usefulRule: string;
    bands: string;
    perEngine: PerEngine[];
    rankingVsTavily: { engine: string; usefulPct: number; band: string; deltaVsTavily: number; meanLatencyMs: number }[];
  };

  const embPath = join(OUT_DIR, "embedding-results.json");
  const emb = existsSync(embPath)
    ? (JSON.parse(readFileSync(embPath, "utf8")) as {
        totalChunks: number;
        chunksPerTopic: Record<string, number>;
        groundTruthLabelledQueries: number;
        chunkScheme: Record<string, unknown>;
        note: string;
        models: Record<string, {
          label?: string; dim?: number; pricePerMTokensUsd?: number; priceSource?: string;
          recallAt5?: number; mrr?: number; ndcgAt10?: number; queriesScored?: number;
          meanQueryEmbedMs?: number; chunkEmbedMs?: number; error?: string;
          qdrant?: { collection: string; pointCount: number } | null;
        }>;
        qdrantIngest: { collection: string; dim: number; pointCount: number; model: string }[];
      })
    : null;

  const topics = Object.keys(search.perEngine[0]?.perTopic ?? {});

  // --- Search winner per §6 ---
  const ranked = [...search.perEngine].sort((a, b) => b.overallUsefulPct - a.overallUsefulPct);
  const best = ranked[0];
  const searxng = search.perEngine.find((e) => e.engine === "searxng");
  // §6: if SearXNG (free) lands within noise (~5pp) of the best paid engine, SearXNG wins on cost.
  const NOISE = 5;
  let searchWinner = best.engine;
  let searchRationale = `Highest grounding-quality useful% (${best.overallUsefulPct}%, band ${best.band}).`;
  if (searxng && best.engine !== "searxng" && best.overallUsefulPct - searxng.overallUsefulPct <= NOISE) {
    searchWinner = "searxng";
    searchRationale = `SearXNG (free, self-hosted) at ${searxng.overallUsefulPct}% is within ${NOISE}pp of the best engine ${best.engine} (${best.overallUsefulPct}%); §6 cost rule -> SearXNG wins.`;
  }

  // --- Embedding winner per §6 ---
  let embSection = "_Embedding eval not run yet (run-embeddings.ts)._\n";
  let embWinner = "(pending)";
  if (emb) {
    const order = ["gemini-embedding-001", "qwen/qwen3-embedding-8b", "qwen/qwen3-embedding-4b"];
    const live = order
      .map((id) => ({ id, ...emb.models[id] }))
      .filter((m) => m && !m.error && typeof m.recallAt5 === "number");
    const byNdcg = [...live].sort((a, b) => (b.ndcgAt10 ?? 0) - (a.ndcgAt10 ?? 0));
    const bestEmb = byNdcg[0];
    const gemini = live.find((m) => m.id === "gemini-embedding-001");
    // §6: default Gemini; switch to Qwen only if it clearly wins (>~3pp nDCG).
    const CLEAR = 0.03;
    embWinner = "gemini-embedding-001 (Gemini Embedding)";
    let embRationale = "Default per §6 (no new key, simplest); not decisively beaten.";
    if (bestEmb && gemini && bestEmb.id !== "gemini-embedding-001" && (bestEmb.ndcgAt10 ?? 0) - (gemini.ndcgAt10 ?? 0) > CLEAR) {
      embWinner = `${bestEmb.label}`;
      embRationale = `${bestEmb.label} wins nDCG@10 by >${CLEAR} over Gemini (${bestEmb.ndcgAt10} vs ${gemini.ndcgAt10}); §6 "switch only if it clearly wins" satisfied.`;
    } else if (gemini && bestEmb && bestEmb.id !== "gemini-embedding-001") {
      embRationale = `Best raw nDCG is ${bestEmb.label} (${bestEmb.ndcgAt10}) but the margin over Gemini (${gemini.ndcgAt10}) is <=${CLEAR} -> §6 keeps the default Gemini.`;
    }

    const header = "| Model | dim | Recall@5 | MRR | nDCG@10 | $/1M tok | mean query latency | n |";
    const sep = "|---|---|---|---|---|---|---|---|";
    const rows = live
      .map((m) => `| ${m.label} | ${m.dim} | ${m.recallAt5} | ${m.mrr} | ${m.ndcgAt10} | $${m.pricePerMTokensUsd} | ${m.meanQueryEmbedMs}ms | ${m.queriesScored} |`)
      .join("\n");

    const ingestRows = emb.qdrantIngest
      .map((q) => `- \`${q.collection}\` — ${q.pointCount} points, dim ${q.dim} (${q.model})`)
      .join("\n");

    embSection = `**Embedding winner (D4): ${embWinner}**

${embRationale}

Corpus: ${emb.totalChunks} chunks (${Object.entries(emb.chunksPerTopic).map(([t, n]) => `${t}: ${n}`).join(", ")}). Chunk scheme: ${JSON.stringify(emb.chunkScheme)}. Ground truth: ${emb.groundTruthLabelledQueries} of ${search.queries} queries had >=1 judge-labelled relevant chunk.

${header}
${sep}
${rows}

Price sources: ${live.map((m) => `${m.label}: ${m.priceSource}`).join(" · ")}

**Qdrant ingestion (Phase-2 path, proven end-to-end):**
${ingestRows}

> Gap: ${emb.note}
`;
  }

  // --- Search tables ---
  const overallHeader = "| Engine | Useful% | Band | mean Rel | mean Cred | mean Ground | mean latency | vs Tavily |";
  const overallSep = "|---|---|---|---|---|---|---|---|";
  const tavily = search.perEngine.find((e) => e.engine === "tavily");
  const overallRows = ranked
    .map((e) => `| ${e.engine} | ${e.overallUsefulPct}% | ${e.band} | ${e.meanRelevance} | ${e.meanCredibility} | ${e.meanGroundability} | ${e.meanLatencyMs}ms | ${tavily ? (e.overallUsefulPct - tavily.overallUsefulPct >= 0 ? "+" : "") + (e.overallUsefulPct - tavily.overallUsefulPct).toFixed(1) + "pp" : "-"} |`)
    .join("\n");

  const topicHeader = `| Engine | ${topics.map((t) => t).join(" | ")} |`;
  const topicSep = `|---|${topics.map(() => "---").join("|")}|`;
  const topicRows = ranked
    .map((e) => `| ${e.engine} | ${topics.map((t) => `${e.perTopic[t].usefulPct}% (${e.perTopic[t].band})`).join(" | ")} |`)
    .join("\n");

  const md = `# L2 Ingestion Bench — Results Summary

Generated ${search.generatedAt}. Judge model: \`${search.judgeModel}\`. Directional bench: ${search.queries} learner queries x 3 topics x 4 engines; extraction success ${search.extractionSuccess}. Not the thesis-grade C.1 study.

## Search engine (ADR 9)

**Winner: ${searchWinner}** — ${searchRationale}

Useful = ${search.usefulRule}. Bands: ${search.bands}.

### Overall (top-5 scored per query)
${overallHeader}
${overallSep}
${overallRows}

### Per-topic useful% (band)
${topicHeader}
${topicSep}
${topicRows}

## Embedding model (D4)

${embSection}

## Decision rules applied (§6)
- **Search:** highest grounding quality at acceptable latency/cost; if SearXNG (free) is within noise (~${NOISE}pp) of the best paid engine, SearXNG wins on cost.
- **Embedding:** default Gemini Embedding; switch to Qwen only if it clearly wins on retrieval quality (we used a >0.03 nDCG@10 margin as "clear").

## Honest limitations
- Directional only: ~${search.queries} queries, small per-topic n; not a powered study.
- The LLM judge scored relevance/credibility; the CEO kappa sample (\`kappa-rating-sheet.html\`) must be rated by the founder before the judge is validated. Kappa is NOT yet computed.
- Groundability + Open PageRank are deterministic; Britannica and some publisher pages block extraction (counted as groundability 0, not fabricated).
- Qwen3-Embedding-0.6B is unavailable on OpenRouter's embeddings endpoint (404) — recorded as a gap, not faked.
- **Qwen caveat (important):** Qwen3-Embedding models expect an instruction prefix on the QUERY side ("Instruct: ...\\nQuery: ...") for retrieval; OpenRouter's raw \`/embeddings\` endpoint embeds the bare string with no instruction hook. The large Gemini margin therefore partly reflects Qwen being run without its intended query-instruction format, not purely model quality. A fair Qwen re-test (self-hosted with the instruct template) is the honest follow-up before ruling Qwen out for cost optimization. The §6 conclusion (default Gemini now) still holds for the as-tested API path.
`;

  writeFileSync(join(OUT_DIR, "RESULTS-SUMMARY.md"), md);
  console.log("Wrote RESULTS-SUMMARY.md");
  console.log(`Search winner: ${searchWinner} | Embedding winner: ${embWinner}`);
}

main();
