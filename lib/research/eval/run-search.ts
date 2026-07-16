/**
 * L2 ingestion bench — search-engine eval (CEO plan steps 2-5, §4). Fan out
 * each query to all 4 engines -> extract every unique URL via Trafilatura/Jina
 * -> enrich with Open PageRank -> score relevance+credibility (LLM judge) +
 * groundability (deterministic) -> compute per-engine bands.
 * Run: bun run lib/research/eval/run-search.ts. Writes: search-results.json,
 * raw-search.json, extractions.json (out/).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));

import { QUERIES, TOPICS } from "./queries";
import type { EngineName, EngineResult, Extraction, SearchHit } from "./types";
import { searxngSearch } from "../searxng";
import { braveSearch } from "../braveSearch";
import { exaSearch } from "../exa";
import { webSearch } from "../tavily";
import { extract } from "../extract";
import { fetchPageRanks, hostOf, type PageRankMap } from "../openPageRank";
import { GeminiClient } from "../../llm/gemini";
import { scoreResult } from "./judge";

const OUT_DIR = join(HERE, "out");
const TOP_N = 8;
const SCORE_TOP_K = 5; // bands computed on top-5 per the rubric

const ENGINES: { name: EngineName; run: (q: string) => Promise<SearchHit[]> }[] = [
  { name: "searxng", run: (q) => searxngSearch(q, TOP_N) },
  { name: "brave", run: (q) => braveSearch(q, TOP_N) },
  { name: "exa", run: (q) => exaSearch(q, TOP_N) },
  {
    name: "tavily",
    run: async (q) =>
      (await webSearch(q, { maxResults: TOP_N })).map((r) => ({ url: r.url, title: r.title, snippet: r.content })),
  },
];

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface ScoredResult {
  engine: EngineName;
  queryId: string;
  topic: string;
  level: string;
  query: string;
  rank: number;
  url: string;
  title: string;
  snippet: string;
  domain: string;
  pageRank: number | null;
  extracted: boolean;
  extractSource: string;
  hasTitle: boolean;
  hasAuthorOrDate: boolean;
  relevance: number; // 0-2
  credibility: number; // 0-2 (judge, then PageRank-adjusted)
  credibilityJudge: number;
  groundability: number; // 0-2 deterministic
  rationale: string;
  useful: boolean; // counts toward the band
}

function groundabilityScore(ex: Extraction | undefined): number {
  if (!ex || !ex.ok || !ex.text) return 0;
  const hasTitle = Boolean(ex.title);
  const hasMeta = Boolean(ex.author || ex.date);
  if (hasTitle && hasMeta) return 2; // clean extract + citable provenance
  return 1; // extracts but thin metadata
}

/** Fold Open PageRank into the judge's credibility 0-2 (clamped). */
function adjustCredibility(judge: number, pr: number | null): number {
  if (pr == null) return judge;
  if (pr >= 6 && judge < 2) return Math.min(2, judge + 1); // strong authority lifts
  if (pr < 2 && judge > 0) return Math.max(0, judge - 1); // weak authority pulls down
  return judge;
}

function band(pct: number): "Poor" | "Mid" | "Good" | "Best" {
  // Plan §4: Poor <40, Good 60-80, Best >80. 40-60 is the unlabelled middle.
  if (pct < 40) return "Poor";
  if (pct < 60) return "Mid";
  if (pct <= 80) return "Good";
  return "Best";
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const client = new GeminiClient();

  // Sequential per engine to respect rate limits.
  console.log("[1/5] Search fan-out...");
  const rawResults: EngineResult[] = [];
  const latencies: Record<EngineName, number[]> = { searxng: [], brave: [], exa: [], tavily: [] };

  for (const q of QUERIES) {
    for (const eng of ENGINES) {
      const t = Date.now();
      try {
        const hits = await eng.run(q.query);
        const latencyMs = Date.now() - t;
        latencies[eng.name].push(latencyMs);
        rawResults.push({ engine: eng.name, query: q.query, ok: true, latencyMs, hits });
      } catch (e) {
        const latencyMs = Date.now() - t;
        rawResults.push({ engine: eng.name, query: q.query, ok: false, error: (e as Error).message, latencyMs, hits: [] });
        console.log(`  ! ${eng.name} failed on "${q.query}": ${(e as Error).message}`);
      }
      await sleep(250); // gentle pacing for the paid engines
    }
    console.log(`  query ${q.id} done`);
  }
  writeFileSync(join(OUT_DIR, "raw-search.json"), JSON.stringify(rawResults, null, 2));

  // Shared across engines + the embedding eval.
  console.log("[2/5] Extraction...");
  const urls = [...new Set(rawResults.flatMap((r) => r.hits.map((h) => h.url)))];
  const extractions: Record<string, Extraction> = {};
  let exOk = 0;
  // Bounded concurrency to keep Trafilatura/Jina responsive.
  const CONC = 6;
  for (let i = 0; i < urls.length; i += CONC) {
    const batch = urls.slice(i, i + CONC);
    const results = await Promise.all(batch.map((u) => extract(u)));
    results.forEach((ex) => {
      extractions[ex.url] = ex;
      if (ex.ok) exOk++;
    });
    console.log(`  extracted ${Math.min(i + CONC, urls.length)}/${urls.length}`);
  }
  console.log(`  extraction success: ${exOk}/${urls.length}`);
  writeFileSync(join(OUT_DIR, "extractions.json"), JSON.stringify(extractions, null, 2));

  console.log("[3/5] Open PageRank...");
  let pageRanks: PageRankMap = {};
  try {
    pageRanks = await fetchPageRanks(urls.map(hostOf));
    console.log(`  pageRank for ${Object.keys(pageRanks).length} domains`);
  } catch (e) {
    console.log(`  ! PageRank failed: ${(e as Error).message}`);
  }

  // Each engine's top-5 per query; LLM judge + deterministic groundability.
  console.log("[4/5] Scoring (LLM judge)...");
  const scored: ScoredResult[] = [];
  const byQueryId = new Map(QUERIES.map((q) => [q.query, q]));

  for (const r of rawResults) {
    if (!r.ok) continue;
    const q = byQueryId.get(r.query);
    if (!q) continue;
    const top = r.hits.slice(0, SCORE_TOP_K);
    for (let rank = 0; rank < top.length; rank++) {
      const hit = top[rank];
      const ex = extractions[hit.url];
      const domain = hostOf(hit.url);
      const pr = pageRanks[domain] ?? null;
      const ground = groundabilityScore(ex);
      let judge;
      try {
        judge = await scoreResult(client, {
          topic: q.topic,
          level: q.level,
          query: q.query,
          title: hit.title,
          url: hit.url,
          snippet: hit.snippet,
          extractPreview: ex?.text ?? "",
        });
      } catch (e) {
        console.log(`  ! judge failed ${r.engine} ${q.id} #${rank}: ${(e as Error).message}`);
        continue;
      }
      const credibility = adjustCredibility(judge.credibility, pr);
      // "useful": relevance>=1, credibility>=1, groundability>=1, and best
      // (==2) on at least one of relevance/credibility. Conservative combined bar.
      const useful = judge.relevance >= 1 && credibility >= 1 && ground >= 1 && (judge.relevance === 2 || credibility === 2);
      scored.push({
        engine: r.engine,
        queryId: q.id,
        topic: q.topic,
        level: q.level,
        query: q.query,
        rank,
        url: hit.url,
        title: hit.title,
        snippet: hit.snippet,
        domain,
        pageRank: pr,
        extracted: Boolean(ex?.ok),
        extractSource: ex?.source ?? "none",
        hasTitle: Boolean(ex?.title),
        hasAuthorOrDate: Boolean(ex?.author || ex?.date),
        relevance: judge.relevance,
        credibility,
        credibilityJudge: judge.credibility,
        groundability: ground,
        rationale: judge.rationale,
        useful,
      });
    }
    process.stdout.write(".");
  }
  console.log("");

  // Per engine x topic: useful%, bands, latency, vs Tavily.
  console.log("[5/5] Aggregating...");
  const engineNames: EngineName[] = ["searxng", "brave", "exa", "tavily"];

  function usefulPct(rows: ScoredResult[]): number {
    if (rows.length === 0) return 0;
    return (100 * rows.filter((s) => s.useful).length) / rows.length;
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

  const perEngine = engineNames.map((eng) => {
    const rows = scored.filter((s) => s.engine === eng);
    const pct = usefulPct(rows);
    const perTopic = Object.fromEntries(
      TOPICS.map((t) => {
        const tr = rows.filter((s) => s.topic === t);
        return [t, { usefulPct: Number(usefulPct(tr).toFixed(1)), band: band(usefulPct(tr)), n: tr.length }];
      }),
    );
    return {
      engine: eng,
      overallUsefulPct: Number(pct.toFixed(1)),
      band: band(pct),
      meanRelevance: Number(mean(rows.map((s) => s.relevance)).toFixed(2)),
      meanCredibility: Number(mean(rows.map((s) => s.credibility)).toFixed(2)),
      meanGroundability: Number(mean(rows.map((s) => s.groundability)).toFixed(2)),
      meanLatencyMs: Math.round(mean(latencies[eng])),
      scoredResults: rows.length,
      perTopic,
    };
  });

  const tavilyPct = perEngine.find((e) => e.engine === "tavily")?.overallUsefulPct ?? 0;
  const ranking = [...perEngine]
    .sort((a, b) => b.overallUsefulPct - a.overallUsefulPct)
    .map((e) => ({ engine: e.engine, usefulPct: e.overallUsefulPct, band: e.band, deltaVsTavily: Number((e.overallUsefulPct - tavilyPct).toFixed(1)), meanLatencyMs: e.meanLatencyMs }));

  const bundle = {
    generatedAt: new Date().toISOString(),
    judgeModel: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
    topN: TOP_N,
    scoreTopK: SCORE_TOP_K,
    queries: QUERIES.length,
    extractionSuccess: `${exOk}/${urls.length}`,
    usefulRule:
      "relevance>=1 AND credibility(PageRank-adjusted)>=1 AND groundability>=1 AND (relevance==2 OR credibility==2)",
    bands: "Poor <40% | Mid 40-60% | Good 60-80% | Best >80% (of scored top-5 useful)",
    perEngine,
    rankingVsTavily: ranking,
    scored,
  };
  writeFileSync(join(OUT_DIR, "search-results.json"), JSON.stringify(bundle, null, 2));
  console.log("Wrote search-results.json");
  console.table(ranking);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
