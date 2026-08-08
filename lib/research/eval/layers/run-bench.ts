/**
 * E05 integration: orchestrates all five layers of the layered eval bench end
 * to end, against a configurable slice of QUERIES_V2 (research-engineer
 * stream) and the judge panel in judge-validation/ (ai-engineer stream). This
 * is the wiring task only — every metric/scoring implementation it calls
 * already exists in this directory or in the two sibling streams; this file
 * does not reimplement any of it.
 *
 * Pipeline (one topic-scoped run):
 *   1. SEARCH+EXTRACT — fetch+extract corpus text for the selected queries'
 *      topic(s), reusing run-search.ts's fetch/extract pattern (Tavily only,
 *      not the 4-engine fan-out — this orchestrator needs one real corpus per
 *      topic, not an engine comparison, so it does not re-spend on the other
 *      3 engines already benchmarked by run-search.ts/ADR 9).
 *   2. CORPUS — chunk the extracted text per topic (qrels/corpus.ts, reused
 *      verbatim, no reimplementation).
 *   3. QRELS — label relevant chunks per query (judge.ts's labelRelevantChunks,
 *      called directly with an onUsage hook so this orchestrator's spend
 *      tracker sees the real cost; qrels/build.ts's own buildQrelsForQuery
 *      does not expose onUsage, see the note on buildQrelsWithUsage below).
 *   4. RETRIEVAL — embed the topic's chunks + each query once (gemini-embedding-001,
 *      same model surface.ts already uses). Default backend ("qdrant", CEO
 *      E05 directive 2026-08-07) ingests the vectors into a dedicated Qdrant
 *      collection (l2_eval_layers_2026_08_07, never the shared production
 *      kc_passages) and ranks via the production searchPassages() primitive
 *      (lib/vector/kcPassages.ts) -- a real qdrant.search() call against the
 *      running local Qdrant server, not an in-memory cosine replica. The
 *      pre-2026-08-07 in-memory cosine path is still available as an
 *      explicit opt-in via --retrieval-backend memory (comparison/fallback
 *      only). Either way the ranking + qrels feed layers/retrieval.ts's
 *      computeRetrievalLayer, whose metric math is backend-agnostic.
 *   5. GENERATION — one structured completion per query that writes a short
 *      grounded answer as a set of atomic claims, each citing the specific
 *      context chunk id(s) that support it (context = the query's own
 *      top-ranked chunks from step 4). This generated text is what layers
 *      3-4 below actually score; it stands in for KnowledgeCore's own
 *      generated tutoring content, which this harness has no lighter-weight
 *      way to produce outside the full app pipeline.
 *   6. GROUNDING — layers/grounding.ts's computeGroundingLayer on the
 *      generated claims against the same top-ranked chunks as the corpus
 *      slice (ALCE citation precision/recall + FActScore).
 *   7. SURFACE — layers/surface.ts's computeSurfaceLayer, with the top-1
 *      retrieved chunk's text as the referenceText (a silver reference: the
 *      single most relevant source passage, not a gold human answer).
 *   8. PEDAGOGICAL — the cross-family judge panel (judge-validation/systems.ts
 *      runKc, judge-validation/providers.ts JUDGE_PANEL) scores the SAME
 *      generated text via the production KC rubric, adapting it into the
 *      rubric's "learner artifact" slot (informationContent = the query's
 *      context chunks, experiencePrompt = a synthesized explain-back prompt,
 *      artifact = the generated text). This is an explicit modeling choice
 *      for this integration smoke, not a validated construct — the KC rubric
 *      was designed to grade a LEARNER's response, not judge generated
 *      tutoring content directly. Flagged here and in the QA WORKLOG; the
 *      wiring (panel call shape, score shape, cost accounting) is what this
 *      task verifies, not the construct validity of scoring generated content
 *      through a learner-response rubric.
 *   9. EXTERNAL — left as a stub invocation (computeExternalLayer([])) with a
 *      skipped manifest entry; TutorEval/MathTutorBench need a dataset
 *      download, explicitly out of scope (see external.ts's own TODO).
 *
 * Hard cost cap: pass --cost-cap-usd (default 2). Every LLM/embedding call in
 * this file is metered into one SpendTracker; assertUnderCap() runs after
 * every metered call and throws SpendCapExceededError, which aborts the run
 * (still writing whatever was collected so far) rather than silently
 * continuing over budget.
 *
 * RETRY: every LLM/embedding/search call in this pipeline (Tavily search,
 * qrels labelling, embedding, generation) is wrapped in ../../retry.ts's
 * withRetry (4 attempts, 2s base backoff, jitter) so a single transient
 * 429/5xx/network blip does not kill a multi-hour run. Non-transient errors
 * (bad schema, safety block, missing API key) are NOT retried.
 *
 * RESUME: step artifacts are checkpointed as soon as they are computed, not
 * only at the end (raw-search.json/extractions.json after step 1,
 * qrels.json after step 3, retrieval-report.json+retrieval-state.json after
 * step 4, generated-content.json after step 5's generation sub-step,
 * grounding/surface/pedagogical-report.json + pedagogical-raw-scores.json
 * after step 6). On startup this file checks OUT_DIR for those artifacts and
 * loads+skips whatever it finds instead of recomputing (resumed steps cost
 * $0 this run -- see buildResumePlan()/logResumePlan() below). Pass --plan to
 * print the resume plan and exit without doing any work or spending
 * anything. Pass --force-steps 3,4,6 (any subset of 1,3,4,5,6) to recompute
 * those named steps unconditionally, ignoring whatever is cached on disk for
 * them (step 2 is always recomputed regardless, it is free and deterministic).
 *
 * QRELS: relevance labels are ALWAYS re-labelled from scratch when
 * qrels.json is missing or forced -- they are never silently blanked, and
 * the existence of a downstream artifact (e.g. retrieval-report.json) is
 * never treated as proof that labels once existed. See buildResumePlan()'s
 * step3/step4 comments and the QA finding this fixes (2026-08-07 CONDITIONAL
 * sign-off, qrels resume bug).
 *
 * PEDAGOGICAL RAW SCORES: every per-(item,judge,dimension) score from the
 * judge panel is persisted to pedagogical-raw-scores.json BEFORE aggregation
 * (computePedagogicalLayer only keeps a cross-judge mean per item, which
 * cannot be un-folded back into per-judge scores). Pairwise Cohen's kappa
 * (quadratic-weighted, 0-4) and Fleiss' kappa (judge-validation/stats.ts) are
 * computed per rubric dimension from those raw scores and attached to
 * pedagogical-report.json as an `agreement` field. See the QA finding this
 * fixes (2026-08-07 CONDITIONAL sign-off, missing raw-score persistence).
 *
 * Run: bun run lib/research/eval/layers/run-bench.ts [--queries 2] [--topics 1]
 *      [--cost-cap-usd 2] [--out out-integration-smoke] [--k 5] [--context 5]
 *      [--plan] [--force-steps 3,4,6] [--retrieval-backend qdrant|memory]
 *      [--eval-collection l2_eval_layers_2026_08_07]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

import { QUERIES_V2, TOPICS_V2, type EvalQuery } from "../queries";
import type { EngineResult, Extraction, SearchHit } from "../types";
import { webSearch } from "../../tavily";
import { extract } from "../../extract";
import { GeminiClient } from "../../../llm/gemini";
import type { UsageCallback } from "../../../llm/types";
import { withRetry } from "../../retry";
import { buildTopicCorpusFromExtractions } from "../qrels/corpus";
import type { Chunk } from "../qrels/types";
import { labelRelevantChunks } from "../judge";
import { EMBED_MODELS, type EmbedUsage } from "../../embeddings/clients";
import { cosine } from "../../embeddings/chunk";
import { qdrant, ensureCollection } from "../../../vector/qdrant";
import { searchPassages, passagePointId, textPreview, KC_PASSAGES_DIM, KC_PASSAGES_DISTANCE, type KcPassagePayload } from "../../../vector/kcPassages";
import { JUDGE_PANEL, usdFor } from "../judge-validation/providers";
import { runKc, type EvalItemInput } from "../judge-validation/systems";
import { quadraticWeightedKappa, fleissKappa, agreementBand, type StatWithReason } from "../judge-validation/stats";

import { computeRetrievalLayer } from "./retrieval";
import { computeGroundingLayer } from "./grounding";
import { computeSurfaceLayer } from "./surface";
import { computePedagogicalLayer } from "./pedagogical";
import { computeExternalLayer } from "./external";
import { llmCallCostUsd, embedCallCostUsd, startTimer } from "./pricing";
import { newManifest, recordLayerRun, recordLayerSkipped, finalizeManifest } from "./manifest";
import type {
  GroundingEvalItem,
  SurfaceEvalItem,
  RetrievalEvalItem,
  PedagogicalJudgeScore,
  LayerReport,
} from "./types";

// --- .env loading (same pattern as judge-validation/run.ts) -----------------
function loadEnv(repoRoot: string): void {
  const p = join(repoRoot, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
const HERE = fileURLToPath(new URL(".", import.meta.url));
const EVAL_DIR = join(HERE, "..");
const REPO_ROOT = join(HERE, "..", "..", "..", "..", "..");
loadEnv(REPO_ROOT);
// The knowledgecore PACKAGE root (EVAL_DIR is <pkg>/lib/research/eval) --
// distinct from REPO_ROOT above, which is one level further up (the
// workspace root .env lives in). Paths typed relative to the package root
// (e.g. "lib/research/eval/foo", the natural thing to type from inside
// knowledgecore/) are resolved against THIS, not REPO_ROOT -- see
// resolveOutDir below.
const PKG_ROOT = join(EVAL_DIR, "..", "..", "..");

// --- args --------------------------------------------------------------------
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const QUERY_COUNT = Number(arg("queries", "2"));
const TOPIC_COUNT = Number(arg("topics", "1"));
const COST_CAP_USD = Number(arg("cost-cap-usd", "2"));
const RETRIEVAL_K = Number(arg("k", "5"));
const CONTEXT_CHUNKS = Number(arg("context", "5"));
const MAX_CHUNKS_PER_TOPIC = Number(arg("max-chunks-per-topic", "24"));
const PLAN_ONLY = process.argv.includes("--plan");

/**
 * RETRIEVAL BACKEND (CEO E05 directive, 2026-08-07): the bench must exercise
 * the ACTUAL built Library retrieval path, not an in-memory cosine replica.
 * Default is "qdrant" -- embed the topic corpus, upsert real vectors into a
 * dedicated Qdrant collection (never the shared production kc_passages), and
 * rank each query by calling the production searchPassages() primitive
 * (lib/vector/kcPassages.ts), which issues a real qdrant.search() call
 * against the running Qdrant server. "memory" keeps the pre-2026-08-07
 * in-memory cosine path available as an explicit opt-in fallback/comparison
 * only -- it is not the default and not what "production" numbers mean now.
 */
const RETRIEVAL_BACKEND = arg("retrieval-backend", "qdrant") as "qdrant" | "memory";
/** Fixed per the CEO directive: a dedicated collection, isolated from the
 *  shared production kc_passages index and from the July D4 l2_eval_* runs.
 *  Overridable via --eval-collection for a deliberately different run. */
const EVAL_QDRANT_COLLECTION = arg("eval-collection", "l2_eval_layers_2026_08_07");

/**
 * --force-steps 3,4,6 -- recompute the named steps unconditionally, ignoring
 * whatever cached artifacts exist for them. Exists so an operator can
 * deliberately discard artifacts that are suspect (e.g. a retrieval-report.json
 * whose qrels are gone, or a pedagogical-report.json that predates raw-score
 * persistence) without deleting files by hand or losing everything else's
 * resume state. Step 2 (corpus) ignores this: it is always recomputed anyway.
 */
const FORCE_STEPS = new Set(
  arg("force-steps", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),
);
function forced(step: number): boolean {
  return FORCE_STEPS.has(step);
}

/**
 * PATH BUG FIX: --out used to be resolved unconditionally against EVAL_DIR
 * (this directory), so passing a value that was ALREADY relative to the repo
 * root (e.g. "lib/research/eval/out-full-2026-08-07", the natural thing to
 * type from the repo root) silently double-nested it under
 * EVAL_DIR/lib/research/eval/out-full-2026-08-07. Sane handling:
 *   - an absolute path is used as-is (path.resolve already did this right).
 *   - a bare name (e.g. "out-integration-smoke") still resolves under
 *     EVAL_DIR, unchanged from before.
 *   - a relative path that already starts with this eval dir's own
 *     repo-relative prefix ("lib/research/eval/...") is resolved from the
 *     repo root instead, so it lands in the same place a human typing that
 *     path from the repo root expects.
 */
function resolveOutDir(raw: string): string {
  if (isAbsolute(raw)) return raw;
  const evalRelPrefix = relative(PKG_ROOT, EVAL_DIR).split(sep).join("/"); // "lib/research/eval"
  const normalizedRaw = raw.split(sep).join("/");
  if (normalizedRaw === evalRelPrefix || normalizedRaw.startsWith(`${evalRelPrefix}/`)) {
    return resolve(PKG_ROOT, raw);
  }
  return resolve(EVAL_DIR, raw);
}
const OUT_DIR = resolveOutDir(arg("out", "out-integration-smoke"));
mkdirSync(OUT_DIR, { recursive: true });

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
const EMBED_MODEL = EMBED_MODELS.find((m) => m.id === "gemini-embedding-001");
if (!EMBED_MODEL) throw new Error("run-bench: gemini-embedding-001 not found in EMBED_MODELS");

// --- spend tracker ------------------------------------------------------------
class SpendCapExceededError extends Error {}

class SpendTracker {
  total = 0;
  breakdown: Record<string, number> = {};
  constructor(private readonly capUsd: number) {}
  add(label: string, usd: number): void {
    this.total += usd;
    this.breakdown[label] = (this.breakdown[label] ?? 0) + usd;
  }
  assertUnderCap(): void {
    if (this.total > this.capUsd) {
      throw new SpendCapExceededError(
        `SPEND CAP EXCEEDED: $${this.total.toFixed(4)} > cap $${this.capUsd.toFixed(2)}. Aborting run.`,
      );
    }
  }
}
const spend = new SpendTracker(COST_CAP_USD);

// --- selection -----------------------------------------------------------------
const selectedTopics = TOPICS_V2.slice(0, TOPIC_COUNT);
const selectedQueries: EvalQuery[] = QUERIES_V2.filter((q) => selectedTopics.includes(q.topic as (typeof TOPICS_V2)[number])).slice(
  0,
  QUERY_COUNT,
);
if (selectedQueries.length === 0) {
  throw new Error(`run-bench: no queries selected (topics=${JSON.stringify(selectedTopics)}, queries=${QUERY_COUNT})`);
}

// --- step 1: search + extract ---------------------------------------------------
async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function searchAndExtract(): Promise<{ rawResults: EngineResult[]; extractions: Record<string, Extraction> }> {
  const rawResults: EngineResult[] = [];
  for (const q of selectedQueries) {
    const t = Date.now();
    try {
      const hits: SearchHit[] = (
        await withRetry(() => webSearch(q.query, { maxResults: 8 }), { label: `tavily:${q.query}` })
      ).map((r) => ({
        url: r.url,
        title: r.title,
        snippet: r.content,
      }));
      rawResults.push({ engine: "tavily", query: q.query, ok: true, latencyMs: Date.now() - t, hits });
    } catch (e) {
      rawResults.push({ engine: "tavily", query: q.query, ok: false, error: (e as Error).message, latencyMs: Date.now() - t, hits: [] });
      console.log(`  ! tavily failed on "${q.query}": ${(e as Error).message}`);
    }
    await sleep(200);
  }
  writeFileSync(join(OUT_DIR, "raw-search.json"), JSON.stringify(rawResults, null, 2));

  const urls = [...new Set(rawResults.flatMap((r) => r.hits.map((h) => h.url)))];
  const extractions: Record<string, Extraction> = {};
  const CONC = 4;
  for (let i = 0; i < urls.length; i += CONC) {
    const batch = urls.slice(i, i + CONC);
    const results = await Promise.all(batch.map((u) => extract(u)));
    results.forEach((ex) => {
      extractions[ex.url] = ex;
    });
  }
  writeFileSync(join(OUT_DIR, "extractions.json"), JSON.stringify(extractions, null, 2));
  return { rawResults, extractions };
}

// --- step 3: qrels, with usage tracking (qrels/build.ts's buildQrelsForQuery
// does not expose onUsage, so this calls judge.ts's labelRelevantChunks
// directly, replicating the same hallucinated-id guard build.ts applies) -----
async function buildQrelsWithUsage(
  client: GeminiClient,
  query: EvalQuery,
  chunks: Chunk[],
  onUsage: UsageCallback,
): Promise<{ relevantChunkIds: string[]; error?: string }> {
  if (!chunks.length) return { relevantChunkIds: [] };
  try {
    const labelled = await withRetry(
      () =>
        labelRelevantChunks(client, { level: query.level, query: query.query, chunks: chunks.map((c) => ({ id: c.id, text: c.text })) }, onUsage),
      { label: `qrels:${query.id}` },
    );
    const validIds = new Set(chunks.map((c) => c.id));
    return { relevantChunkIds: labelled.relevantChunkIds.filter((id) => validIds.has(id)) };
  } catch (e) {
    return { relevantChunkIds: [], error: (e as Error).message };
  }
}

// --- step 5: grounded generation ------------------------------------------------
const GeneratedAnswerSchema = z.object({
  claims: z
    .array(
      z.object({
        text: z.string().describe("One short, self-contained factual sentence."),
        citedChunkIds: z
          .array(z.string())
          .describe("1-2 ids, taken verbatim from the CONTEXT block's [id] tags, that support this claim."),
      }),
    )
    .min(2)
    .max(5),
});

async function generateGroundedAnswer(
  client: GeminiClient,
  query: EvalQuery,
  contextChunks: Chunk[],
  onUsage: UsageCallback,
): Promise<{ claims: { text: string; citedChunkIds: string[] }[] }> {
  const contextBlock = contextChunks.map((c) => `[${c.id}] ${c.text.slice(0, 700)}`).join("\n\n");
  return withRetry(
    () =>
      client.completeStructured({
        schema: GeneratedAnswerSchema,
        schemaName: "GeneratedAnswer",
        system:
          "You write short tutoring content for a learner. Using ONLY the provided CONTEXT chunks, write 2-4 " +
          "short factual claims that together answer the learner's query at the stated level. Every claim MUST " +
          "cite the id(s) of the CONTEXT chunk(s) that support it. Do not invent chunk ids and do not use " +
          "outside knowledge not present in CONTEXT.",
        temperature: 0,
        messages: [
          { role: "user", content: `QUERY: ${query.query}\nLEVEL: ${query.level}\n\nCONTEXT:\n${contextBlock}` },
        ],
        onUsage,
      }),
    { label: `generate:${query.id}` },
  );
}

// --- step 6: inter-judge agreement (Cohen's + Fleiss' kappa) ---------------
// RAW-SCORE PERSISTENCE FIX: computed here, from the raw per-(item,judge)
// PedagogicalJudgeScore[] BEFORE it is folded into per-item means, per the
// QA finding this fixes (2026-08-07 CONDITIONAL sign-off): the folded
// pedagogical-report.json alone cannot be un-folded back into per-judge
// scores, so kappa could not be computed after the fact. Both statistics are
// pulled from judge-validation/stats.ts (already used by the thesis Ch.6
// calibration study), not reimplemented here.
interface PairwiseKappaEntry {
  judgeA: string;
  judgeB: string;
  kappa: number | null;
  band: string;
  n: number;
  undefinedReason?: string;
}
interface DimensionAgreement {
  dimension: string;
  pairwiseCohenKappa: PairwiseKappaEntry[];
  fleissKappa: number | null;
  fleissBand: string;
  fleissN: number;
  fleissUndefinedReason?: string;
}
interface PedagogicalAgreementReport {
  judgeCount: number;
  judgeKeys: string[];
  dimensions: DimensionAgreement[];
  note: string;
}

function computePedagogicalAgreement(scores: PedagogicalJudgeScore[]): PedagogicalAgreementReport {
  const judgeKeys = JUDGE_PANEL.map((j) => j.key);
  const dimensionKeys = [...new Set(scores.flatMap((s) => Object.keys(s.dimensionScores)))].sort();

  const byItemJudge = new Map<string, Map<string, PedagogicalJudgeScore>>();
  for (const s of scores) {
    const m = byItemJudge.get(s.itemId) ?? new Map<string, PedagogicalJudgeScore>();
    m.set(s.judgeKey, s);
    byItemJudge.set(s.itemId, m);
  }

  const dimensions: DimensionAgreement[] = dimensionKeys.map((dim) => {
    // Pairwise Cohen's kappa (quadratic-weighted, 0-4 ordinal rubric scale)
    // over every judge pair, using only items both judges in the pair scored.
    const pairwiseCohenKappa: PairwiseKappaEntry[] = [];
    for (let i = 0; i < judgeKeys.length; i++) {
      for (let j = i + 1; j < judgeKeys.length; j++) {
        const a: number[] = [];
        const b: number[] = [];
        for (const m of byItemJudge.values()) {
          const sa = m.get(judgeKeys[i]);
          const sb = m.get(judgeKeys[j]);
          if (sa && sb && typeof sa.dimensionScores[dim] === "number" && typeof sb.dimensionScores[dim] === "number") {
            a.push(sa.dimensionScores[dim]);
            b.push(sb.dimensionScores[dim]);
          }
        }
        const r = quadraticWeightedKappa(a, b, 0, 4);
        pairwiseCohenKappa.push({
          judgeA: judgeKeys[i],
          judgeB: judgeKeys[j],
          kappa: r.value,
          band: agreementBand(r.value),
          n: r.n,
          undefinedReason: r.undefinedReason,
        });
      }
    }

    // Fleiss' kappa needs a FIXED rater count per unit: only items scored by
    // every panel judge on this dimension contribute (see fleissN for how
    // many that ends up being; smaller than the item count if any judge call
    // failed and was skipped).
    const ratings: number[][] = [];
    for (const m of byItemJudge.values()) {
      const row = judgeKeys.map((k) => m.get(k)?.dimensionScores[dim]);
      if (row.every((v): v is number => typeof v === "number")) ratings.push(row as number[]);
    }
    const f: StatWithReason = fleissKappa(ratings, 0, 4);

    return {
      dimension: dim,
      pairwiseCohenKappa,
      fleissKappa: f.value,
      fleissBand: agreementBand(f.value),
      fleissN: f.n,
      fleissUndefinedReason: f.undefinedReason,
    };
  });

  return {
    judgeCount: judgeKeys.length,
    judgeKeys,
    dimensions,
    note:
      "Cohen's kappa is pairwise, quadratic-weighted over the 0-4 rubric scale, per judge pair. " +
      "Fleiss' kappa is computed only over items scored by ALL panel judges on that dimension " +
      "(see fleissN); items with a missing/failed judge call are excluded, not coerced. Both " +
      "return null with undefinedReason when degenerate (e.g. a judge used a single category " +
      "throughout, per judge-validation/stats.ts's convention).",
  };
}

// --- resume/checkpoint infra -----------------------------------------------
// Each key is an artifact file this pipeline writes as a checkpoint. Some
// (qrels.json, retrieval-state.json, generated-content.json) used to be
// written only at the very end of a full run; they are now written
// immediately after the step that produces them so a killed run always
// leaves behind everything it already finished, not just whatever happened
// to be written before the crash.
const ARTIFACT_FILES = {
  rawSearch: "raw-search.json",
  extractions: "extractions.json",
  qrels: "qrels.json",
  retrievalReport: "retrieval-report.json",
  retrievalState: "retrieval-state.json",
  generatedContent: "generated-content.json",
  groundingReport: "grounding-report.json",
  surfaceReport: "surface-report.json",
  pedagogicalReport: "pedagogical-report.json",
  pedagogicalRaw: "pedagogical-raw-scores.json",
} as const;
type ArtifactKey = keyof typeof ARTIFACT_FILES;

function artifactPath(key: ArtifactKey): string {
  return join(OUT_DIR, ARTIFACT_FILES[key]);
}
function hasArtifact(key: ArtifactKey): boolean {
  return existsSync(artifactPath(key));
}
function loadArtifact<T>(key: ArtifactKey): T {
  return JSON.parse(readFileSync(artifactPath(key), "utf8")) as T;
}
function writeArtifact(key: ArtifactKey, data: unknown): void {
  writeFileSync(artifactPath(key), JSON.stringify(data, null, 2));
}

interface QrelsCacheEntry {
  relevantChunkIds: string[];
  candidateChunkIds: string[];
  error: string | null;
}
type QrelsCache = Record<string, QrelsCacheEntry>;

/** Sentinel error string the pre-fix resume bug wrote into every qrels.json
 *  entry when it silently blanked relevantChunkIds instead of re-labelling.
 *  A qrels.json carrying this sentinel is corrupted data from that bug, not
 *  a legitimate cache -- it must be discarded and re-labelled from scratch,
 *  the same as a missing qrels.json, not resumed as if it were valid. */
const LEGACY_BLANKED_QRELS_SENTINEL = "resumed-legacy-no-cache";

/** Loads qrels.json (if present) and reports whether it carries the pre-fix
 *  bug's sentinel. A malformed/unparseable file is treated as absent rather
 *  than thrown on, consistent with this being a best-effort health check. */
function loadQrelsCacheIfHealthy(): { cache: QrelsCache | null; legacyBlanked: boolean } {
  if (!hasArtifact("qrels")) return { cache: null, legacyBlanked: false };
  try {
    const cache = loadArtifact<QrelsCache>("qrels");
    const legacyBlanked = Object.values(cache).some((c) => c.error === LEGACY_BLANKED_QRELS_SENTINEL);
    return { cache, legacyBlanked };
  } catch {
    return { cache: null, legacyBlanked: false };
  }
}

interface RetrievalStateEntry {
  rankedChunkIds: string[];
  topContextChunkIds: string[];
}
type RetrievalStateCache = Record<string, RetrievalStateEntry>;

interface GeneratedContentEntry {
  generatedText: string;
  claims: { id: string; text: string; citedChunkIds: string[] }[];
  /** Ids of the top-ranked context chunks generation was grounded in, so a
   *  resumed run can rebuild topContextChunks from chunksByTopic without
   *  re-embedding. Optional: absent on files written before this field
   *  existed, in which case context is not reconstructable from this cache
   *  alone. */
  contextChunkIds?: string[];
}
type GeneratedContentCache = Record<string, GeneratedContentEntry>;

interface ResumeStepPlan {
  step: number;
  name: string;
  resumable: boolean;
  detail: string;
}

/**
 * Coarse, step-level resume plan: which of the 6 pipeline steps already has
 * artifacts on disk, and which step execution would resume from. Pure
 * artifact-existence check, no JSON parsing beyond existsSync -- safe and
 * cheap to run standalone via --plan.
 *
 * A later artifact's existence is treated as proof an earlier, not
 * separately checkpointed step already ran (retrieval-report.json cannot
 * exist unless qrels already labelled relevance), so this also plans
 * correctly against legacy runs made before qrels.json/retrieval-state.json/
 * generated-content.json were checkpointed per-step.
 */
function buildResumePlan(): { steps: ResumeStepPlan[]; nextStep: number | null } {
  const have = {
    rawSearch: hasArtifact("rawSearch"),
    extractions: hasArtifact("extractions"),
    qrels: hasArtifact("qrels"),
    retrievalReport: hasArtifact("retrievalReport"),
    retrievalState: hasArtifact("retrievalState"),
    generatedContent: hasArtifact("generatedContent"),
    groundingReport: hasArtifact("groundingReport"),
    surfaceReport: hasArtifact("surfaceReport"),
    pedagogicalReport: hasArtifact("pedagogicalReport"),
    pedagogicalRaw: hasArtifact("pedagogicalRaw"),
  };

  const step1 = have.rawSearch && have.extractions && !forced(1);
  // QRELS RESUME BUG FIX: qrels are resumable ONLY from a HEALTHY qrels.json.
  // The mere existence of a downstream retrieval-report.json is NO LONGER
  // accepted as proof relevance labels are cached -- that was the exact bug
  // (relevantChunkIds silently blanked to [] with error
  // "resumed-legacy-no-cache" while the stale report was reused verbatim).
  // A qrels.json that itself carries that sentinel (written by the pre-fix
  // bug) is ALSO not resumable -- it is corrupted data, not a valid cache --
  // so it is discarded and re-labelled from scratch exactly like a missing
  // file, not silently trusted just because it exists on disk.
  const qrelsHealth = loadQrelsCacheIfHealthy();
  const step3 = have.qrels && !forced(3) && !qrelsHealth.legacyBlanked;
  // A cached retrieval-report.json is only trustworthy when the qrels behind
  // it are ALSO being resumed unchanged this run. If qrels are being
  // (re-)labelled this run (step3 not resumable), the old report's
  // nDCG/Recall/MRR no longer correspond to what is on disk and must be
  // recomputed, never silently reused.
  const step4 = have.retrievalReport && !forced(4) && step3;
  const step5 = have.generatedContent && have.groundingReport && have.surfaceReport && !forced(5);
  // RAW-SCORE PERSISTENCE FIX: pedagogical-report.json alone is not enough to
  // resume from -- it only holds the folded per-item mean, which cannot be
  // un-folded back into per-(item,judge,dimension) scores for kappa. A run
  // that has the report but not pedagogical-raw-scores.json (i.e. predates
  // this fix) is treated as NOT resumable and recomputed.
  const step6 = have.pedagogicalReport && have.pedagogicalRaw && !forced(6);

  const steps: ResumeStepPlan[] = [
    {
      step: 1,
      name: "search + extract",
      resumable: step1,
      detail: forced(1)
        ? "--force-steps includes 1 -- will re-run Tavily search + extraction, ignoring any cached artifacts"
        : step1
          ? "raw-search.json + extractions.json found -- loaded, $0"
          : "raw-search.json/extractions.json missing -- will run Tavily search + extraction",
    },
    {
      step: 2,
      name: "corpus",
      resumable: false,
      detail: "always recomputed from extractions (deterministic chunking, no LLM/network cost)",
    },
    {
      step: 3,
      name: "qrels",
      resumable: step3,
      detail: forced(3)
        ? "--force-steps includes 3 -- will re-label relevance from scratch, ignoring qrels.json"
        : step3
          ? "qrels.json found -- loaded, $0"
          : qrelsHealth.legacyBlanked
            ? "qrels.json found but carries the pre-fix bug's sentinel (relevantChunkIds silently blanked, error=\"resumed-legacy-no-cache\") -- discarding it, will re-label relevance from scratch"
            : "qrels.json missing -- will re-label relevance from scratch (never blanked silently, regardless of what other artifacts exist)",
    },
    {
      step: 4,
      name: "retrieval (embed + rank)",
      resumable: step4,
      detail: forced(4)
        ? "--force-steps includes 4 -- will re-embed + re-rank, ignoring cached retrieval-report.json"
        : !have.retrievalReport
          ? "retrieval-report.json missing -- will embed + rank"
          : !step3
            ? "retrieval-report.json found but qrels are being (re-)labelled this run -- stale report discarded, will re-embed + re-rank against the fresh qrels"
            : have.retrievalState
              ? "retrieval-report.json + retrieval-state.json found -- loaded, $0"
              : "retrieval-report.json found but retrieval-state.json (per-query ranked-context cache, introduced by an earlier fix) missing (legacy run) -- report is reused as-is, but ranked context for generation will be reconstructed with a fresh (small) embedding pass",
    },
    {
      step: 5,
      name: "generation + grounding + surface",
      resumable: step5,
      detail: forced(5)
        ? "--force-steps includes 5 -- will re-generate, ignoring cached generated-content.json/grounding-report.json/surface-report.json"
        : `generation:${have.generatedContent ? "resumed $0" : "recompute"}, ` +
          `grounding:${have.groundingReport && have.generatedContent ? "resumed $0" : have.groundingReport ? "found but stale (generation not cached) -- recompute" : "recompute"}, ` +
          `surface:${have.surfaceReport && have.generatedContent ? "resumed $0" : have.surfaceReport ? "found but stale (generation not cached) -- recompute" : "recompute"}`,
    },
    {
      step: 6,
      name: "pedagogical (judge panel)",
      resumable: step6 && (have.generatedContent || !step5),
      detail: forced(6)
        ? "--force-steps includes 6 -- will re-run the judge panel, ignoring pedagogical-report.json/pedagogical-raw-scores.json"
        : have.pedagogicalReport && !have.pedagogicalRaw
          ? "pedagogical-report.json found but pedagogical-raw-scores.json missing (predates raw-score persistence) -- kappa cannot be recovered from this artifact alone, will recompute"
          : have.pedagogicalReport && have.pedagogicalRaw
            ? "pedagogical-report.json + pedagogical-raw-scores.json found -- loaded, $0"
            : "pedagogical-report.json missing -- will run judge panel",
    },
  ];

  const firstUnresumed = steps.find((s) => s.step !== 2 && !s.resumable);
  const nextStep = firstUnresumed ? firstUnresumed.step : null;
  return { steps, nextStep };
}

function logResumePlan(plan: ReturnType<typeof buildResumePlan>): void {
  console.log(`[resume] OUT_DIR=${OUT_DIR}`);
  for (const s of plan.steps) {
    const tag = s.step === 2 ? "ALWAYS" : s.resumable ? "RESUMED" : "RECOMPUTE";
    console.log(`  step ${s.step} (${s.name}): ${tag} -- ${s.detail}`);
  }
  console.log(
    plan.nextStep === null
      ? "[resume] every step already has artifacts on disk; a real run would recompute nothing (still writes manifest/cost-summary)."
      : `[resume] would resume from step ${plan.nextStep}.`,
  );
}

// --- run ------------------------------------------------------------------------

interface QueryRunState {
  query: EvalQuery;
  topicChunks: Chunk[];
  rankedChunkIds: string[];
  relevantChunkIds: string[];
  qrelsError?: string;
  generatedText: string;
  claims: { id: string; text: string; citedChunkIds: string[] }[];
  topContextChunks: Chunk[];
}

async function main() {
  const plan = buildResumePlan();
  logResumePlan(plan);
  if (PLAN_ONLY) return;

  const runId = `e05-integration-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const manifest = newManifest(runId);
  let aborted = false;
  let abortReason: string | null = null;

  console.log(`[run-bench] topics=${JSON.stringify(selectedTopics)} queries=${selectedQueries.map((q) => q.id).join(",")} cap=$${COST_CAP_USD}`);

  console.log("[1/6] search + extract...");
  let rawResults: EngineResult[];
  let extractions: Record<string, Extraction>;
  if (hasArtifact("rawSearch") && hasArtifact("extractions")) {
    rawResults = loadArtifact<EngineResult[]>("rawSearch");
    extractions = loadArtifact<Record<string, Extraction>>("extractions");
    console.log(`  RESUMED: ${rawResults.length} search results, ${Object.keys(extractions).length} extractions loaded from disk ($0)`);
  } else {
    ({ rawResults, extractions } = await searchAndExtract());
  }

  console.log("[2/6] corpus...");
  const client = new GeminiClient();
  const chunksByTopic: Record<string, Chunk[]> = {};
  for (const topic of selectedTopics) {
    chunksByTopic[topic] = buildTopicCorpusFromExtractions(topic, selectedQueries, rawResults, extractions, MAX_CHUNKS_PER_TOPIC);
    console.log(`  ${topic}: ${chunksByTopic[topic].length} chunks`);
  }

  const states: QueryRunState[] = selectedQueries.map((q) => ({
    query: q,
    topicChunks: chunksByTopic[q.topic] ?? [],
    rankedChunkIds: [],
    relevantChunkIds: [],
    generatedText: "",
    claims: [],
    topContextChunks: [],
  }));

  const onLlmUsage: UsageCallback = (usage, model) => {
    spend.add(`llm:${model}`, llmCallCostUsd(model, usage.inputTokens, usage.outputTokens));
  };
  const onEmbedUsage = (label: string): ((u: EmbedUsage) => void) => (u) => {
    const usd = u.costUsd ?? embedCallCostUsd(EMBED_MODEL!.id, u.tokens);
    spend.add(label, usd);
  };

  const retrievalItems: RetrievalEvalItem[] = [];
  const groundingItems: GroundingEvalItem[] = [];
  const surfaceItems: SurfaceEvalItem[] = [];
  const pedagogicalScores: PedagogicalJudgeScore[] = [];

  // qrels.json / retrieval-report.json+retrieval-state.json / generated-content.json
  // are checkpointed as soon as their step finishes, further down -- not
  // just at the very end -- so a run killed after step N always leaves N's
  // artifacts behind for the next invocation to resume from.
  const hadGeneratedContent = hasArtifact("generatedContent") && !forced(5);

  try {
    console.log("[3/6] qrels...");
    // QRELS RESUME BUG FIX: relevance labels are resumable ONLY from a
    // HEALTHY qrels.json. The previous version treated the mere existence of
    // retrieval-report.json as proof qrels already ran, and since the labels
    // were not separately cached from that legacy run, silently set
    // relevantChunkIds to [] with error "resumed-legacy-no-cache" and then
    // reused that report's nDCG/Recall/MRR numbers verbatim -- numbers that
    // could never be reproduced or audited because the labels behind them
    // were gone. That silent blank never happens now: if qrels.json is
    // missing, unhealthy (carries that same sentinel from a run made before
    // this fix), or --force-steps includes 3, relevance is ALWAYS
    // re-labelled from scratch. qrelsFreshlyLabelled also tells step 4 below
    // that any cached retrieval-report.json is stale and must be recomputed,
    // not reused.
    let qrelsFreshlyLabelled = false;
    const qrelsHealth = loadQrelsCacheIfHealthy();
    if (qrelsHealth.cache && !forced(3) && !qrelsHealth.legacyBlanked) {
      const cache = qrelsHealth.cache;
      for (const s of states) {
        const c = cache[s.query.id];
        s.relevantChunkIds = c?.relevantChunkIds ?? [];
        s.qrelsError = c?.error ?? undefined;
      }
      console.log(`  RESUMED: qrels.json loaded for ${Object.keys(cache).length} items ($0)`);
    } else {
      if (forced(3)) {
        console.log("  --force-steps includes 3 -- re-labelling relevance from scratch, ignoring qrels.json");
      } else if (qrelsHealth.legacyBlanked) {
        console.log(
          '  qrels.json found but carries the pre-fix bug\'s sentinel (relevantChunkIds silently blanked, error="resumed-legacy-no-cache") -- discarding it, re-labelling relevance from scratch',
        );
      } else {
        console.log("  qrels.json missing -- re-labelling relevance from scratch (never blanked silently)");
      }
      qrelsFreshlyLabelled = true;
      for (const s of states) {
        const r = await buildQrelsWithUsage(client, s.query, s.topicChunks, onLlmUsage);
        s.relevantChunkIds = r.relevantChunkIds;
        s.qrelsError = r.error;
        spend.assertUnderCap();
        console.log(`  ${s.query.id}: ${r.relevantChunkIds.length} relevant / ${s.topicChunks.length} candidates`);
      }
    }
    // Checkpoint immediately (moved earlier than end-of-run so a later crash
    // doesn't lose it).
    writeArtifact(
      "qrels",
      Object.fromEntries(
        states.map((s) => [
          s.query.id,
          { relevantChunkIds: s.relevantChunkIds, candidateChunkIds: s.topicChunks.map((c) => c.id), error: s.qrelsError ?? null },
        ]),
      ) satisfies QrelsCache,
    );

    console.log("[4/6] retrieval (embed + rank)...");
    let retrievalReport: LayerReport;
    if (hasArtifact("retrievalState") && hasArtifact("retrievalReport") && !qrelsFreshlyLabelled && !forced(4)) {
      const stateCache = loadArtifact<RetrievalStateCache>("retrievalState");
      for (const s of states) {
        const c = stateCache[s.query.id];
        s.rankedChunkIds = c?.rankedChunkIds ?? [];
        const byId = new Map(s.topicChunks.map((ch) => [ch.id, ch]));
        s.topContextChunks = (c?.topContextChunkIds ?? []).map((id) => byId.get(id)!).filter(Boolean);
      }
      retrievalReport = loadArtifact<LayerReport>("retrievalReport");
      console.log(`  RESUMED: retrieval-report.json + retrieval-state.json loaded for ${Object.keys(stateCache).length} items ($0)`);
    } else {
      // QRELS RESUME BUG FIX: a cached retrieval-report.json is only reused
      // as-is when the qrels behind it are ALSO being resumed unchanged this
      // run. If qrels were just (re-)labelled (qrelsFreshlyLabelled) or
      // --force-steps includes 4, the report no longer corresponds to what
      // is on disk and is discarded, never silently reused. Otherwise this
      // is either a genuinely fresh run (no retrieval-report.json at all --
      // do the full embed+rank+score), or a legacy run with a report but no
      // per-query state cache (reuse the report verbatim, but reconstruct
      // ranked context with a fresh embedding pass since generation needs
      // it and there is no way to recover it from the report's aggregate
      // metrics alone).
      const legacyReuse = hasArtifact("retrievalReport") && !qrelsFreshlyLabelled && !forced(4);
      if (legacyReuse) {
        console.log("  retrieval-report.json found (legacy, no retrieval-state.json) -- reusing report as-is, reconstructing ranked context via a fresh embedding pass");
      } else if (hasArtifact("retrievalReport") && qrelsFreshlyLabelled) {
        console.log("  retrieval-report.json found but qrels were just (re-)labelled this run -- discarding stale report, recomputing nDCG/Recall/MRR against the fresh qrels");
      } else if (hasArtifact("retrievalReport") && forced(4)) {
        console.log("  --force-steps includes 4 -- discarding cached retrieval-report.json, recomputing");
      }
      console.log(`  retrieval-backend=${RETRIEVAL_BACKEND}`);
      if (RETRIEVAL_BACKEND === "qdrant") {
        // REAL QDRANT PATH (CEO E05 directive, 2026-08-07): ingest the topic
        // corpora into a dedicated collection and rank via the production
        // searchPassages() primitive (lib/vector/kcPassages.ts) -- a real
        // qdrant.search() call against the running local Qdrant server, not
        // an in-memory cosine replica. bundleIds=[topic] payload scoping
        // mirrors the production per-journey scope filter in
        // learnerSearch.ts, applied here per-topic so queries from different
        // topics sharing one collection cannot leak into each other's
        // ranking, exactly like the production isolation guarantee.
        if (!legacyReuse) {
          try {
            await qdrant.deleteCollection(EVAL_QDRANT_COLLECTION);
          } catch {
            // collection may not exist yet
          }
          await ensureCollection(EVAL_QDRANT_COLLECTION, KC_PASSAGES_DIM, KC_PASSAGES_DISTANCE);
          console.log(`  qdrant: recreated collection ${EVAL_QDRANT_COLLECTION} (dim=${KC_PASSAGES_DIM}, distance=${KC_PASSAGES_DISTANCE})`);
          for (const topic of selectedTopics) {
            const chunks = chunksByTopic[topic];
            if (!chunks.length) continue;
            const vecs = await EMBED_MODEL!.embed(chunks.map((c) => c.text), onEmbedUsage(`embed:${EMBED_MODEL!.id}:corpus`));
            spend.assertUnderCap();
            await qdrant.upsert(EVAL_QDRANT_COLLECTION, {
              wait: true,
              points: chunks.map((c, i) => ({
                id: passagePointId(c.id),
                vector: vecs[i],
                payload: {
                  chunkId: c.id,
                  sourceId: c.sourceUrl,
                  bundleIds: [topic],
                  ordinal: i,
                  sourceKind: "web",
                  textPreview: textPreview(c.text),
                } satisfies KcPassagePayload,
              })),
            });
            console.log(`  qdrant: ingested ${chunks.length} chunks for topic "${topic}"`);
          }
        }
        for (const s of states) {
          const chunks = s.topicChunks;
          if (!chunks.length) {
            s.rankedChunkIds = [];
            continue;
          }
          const [qVec] = await (EMBED_MODEL!.embedQuery ?? EMBED_MODEL!.embed)(
            [s.query.query],
            onEmbedUsage(`embed:${EMBED_MODEL!.id}:query`),
          );
          spend.assertUnderCap();
          // Real production retrieval primitive: real qdrant.search() call,
          // server-side scoring, not JS array cosine math. limit = full topic
          // corpus size so the ranking (not just top-k) is complete, matching
          // what the in-memory path used to hand computeRetrievalLayer.
          const hits = await searchPassages({
            vector: qVec,
            limit: chunks.length,
            filter: { bundleId: s.query.topic },
            collection: EVAL_QDRANT_COLLECTION,
          });
          const ranked = hits.map((h) => h.payload.chunkId);
          s.rankedChunkIds = ranked;
          const byId = new Map(chunks.map((c) => [c.id, c]));
          s.topContextChunks = ranked.slice(0, CONTEXT_CHUNKS).map((id) => byId.get(id)!).filter(Boolean);
          retrievalItems.push({ itemId: s.query.id, rankedChunkIds: ranked, relevantChunkIds: s.relevantChunkIds });
        }
      } else {
        // --retrieval-backend memory: the pre-2026-08-07 in-memory cosine
        // path, kept only as an explicit opt-in fallback/comparison. NOT the
        // default -- see the CEO E05 directive at the top of RETRIEVAL_BACKEND.
        const embeddedByTopic = new Map<string, { id: string; vec: number[] }[]>();
        for (const topic of selectedTopics) {
          const chunks = chunksByTopic[topic];
          if (!chunks.length) {
            embeddedByTopic.set(topic, []);
            continue;
          }
          const vecs = await EMBED_MODEL!.embed(chunks.map((c) => c.text), onEmbedUsage(`embed:${EMBED_MODEL!.id}:corpus`));
          spend.assertUnderCap();
          embeddedByTopic.set(topic, chunks.map((c, i) => ({ id: c.id, vec: vecs[i] })));
        }
        for (const s of states) {
          const chunkVecs = embeddedByTopic.get(s.query.topic) ?? [];
          if (!chunkVecs.length) {
            s.rankedChunkIds = [];
            continue;
          }
          const [qVec] = await (EMBED_MODEL!.embedQuery ?? EMBED_MODEL!.embed)(
            [s.query.query],
            onEmbedUsage(`embed:${EMBED_MODEL!.id}:query`),
          );
          spend.assertUnderCap();
          const ranked = chunkVecs
            .map((cv) => ({ id: cv.id, sim: cosine(qVec, cv.vec) }))
            .sort((a, b) => b.sim - a.sim)
            .map((r) => r.id);
          s.rankedChunkIds = ranked;
          const byId = new Map(s.topicChunks.map((c) => [c.id, c]));
          s.topContextChunks = ranked.slice(0, CONTEXT_CHUNKS).map((id) => byId.get(id)!).filter(Boolean);
          retrievalItems.push({ itemId: s.query.id, rankedChunkIds: ranked, relevantChunkIds: s.relevantChunkIds });
        }
      }
      retrievalReport = legacyReuse
        ? loadArtifact<LayerReport>("retrievalReport")
        : computeRetrievalLayer(retrievalItems, RETRIEVAL_K);
      if (!legacyReuse) {
        recordLayerRun(manifest, retrievalReport, `${retrievalItems.length} queries, k=${RETRIEVAL_K}, backend=${RETRIEVAL_BACKEND}, live corpus`);
        writeArtifact("retrievalReport", retrievalReport);
      }
    }
    if (!hasArtifact("retrievalState") || qrelsFreshlyLabelled || forced(4)) {
      writeArtifact(
        "retrievalState",
        Object.fromEntries(
          states.map((s) => [s.query.id, { rankedChunkIds: s.rankedChunkIds, topContextChunkIds: s.topContextChunks.map((c) => c.id) }]),
        ) satisfies RetrievalStateCache,
      );
    }
    if (hasArtifact("retrievalReport") && !manifest.layers.some((l) => l.layer === "retrieval")) {
      recordLayerRun(manifest, retrievalReport, "RESUMED from disk, $0 this run");
    }

    console.log("[5/6] generation + grounding + surface...");
    // Grounding/surface are only safe to resume verbatim if the generated
    // content they were scored against is ALSO cached -- otherwise a fresh
    // generation this run would silently be scored by a stale report.
    if (hadGeneratedContent) {
      const genCache = loadArtifact<GeneratedContentCache>("generatedContent");
      for (const s of states) {
        const c = genCache[s.query.id];
        if (!c) continue;
        s.generatedText = c.generatedText;
        s.claims = c.claims;
        if (c.contextChunkIds && !s.topContextChunks.length) {
          const byId = new Map(s.topicChunks.map((ch) => [ch.id, ch]));
          s.topContextChunks = c.contextChunkIds.map((id) => byId.get(id)!).filter(Boolean);
        }
      }
      console.log(`  RESUMED: generated-content.json loaded for ${Object.keys(genCache).length} items ($0)`);
    } else {
      for (const s of states) {
        if (!s.topContextChunks.length) {
          console.log(`  ! ${s.query.id}: no retrieved context, skipping generation`);
          continue;
        }
        const gen = await generateGroundedAnswer(client, s.query, s.topContextChunks, onLlmUsage);
        spend.assertUnderCap();
        s.claims = gen.claims.map((c, i) => ({ id: `${s.query.id}-claim${i}`, text: c.text, citedChunkIds: c.citedChunkIds }));
        s.generatedText = s.claims.map((c) => c.text).join(" ");
      }
      // Checkpoint immediately (moved earlier than end-of-run).
      writeArtifact(
        "generatedContent",
        Object.fromEntries(
          states.map((s) => [
            s.query.id,
            { generatedText: s.generatedText, claims: s.claims, contextChunkIds: s.topContextChunks.map((c) => c.id) },
          ]),
        ) satisfies GeneratedContentCache,
      );
    }

    for (const s of states) {
      if (!s.generatedText) continue;
      groundingItems.push({
        itemId: s.query.id,
        generatedText: s.generatedText,
        claims: s.claims,
        corpus: s.topContextChunks.map((c) => ({ id: c.id, text: c.text })),
      });
      surfaceItems.push({
        itemId: s.query.id,
        generatedText: s.generatedText,
        referenceText: s.topContextChunks[0]?.text,
      });
    }

    let groundingReport: LayerReport;
    if (hasArtifact("groundingReport") && hadGeneratedContent && !forced(5)) {
      groundingReport = loadArtifact<LayerReport>("groundingReport");
      recordLayerRun(manifest, groundingReport, "RESUMED from disk, $0 this run");
      console.log("  RESUMED: grounding-report.json loaded ($0)");
    } else {
      groundingReport = await computeGroundingLayer(client, groundingItems);
      spend.add("grounding-layer-reported", groundingReport.totalCostUsd);
      spend.assertUnderCap();
      recordLayerRun(manifest, groundingReport, `${groundingItems.length} generated items, live corpus`);
      writeArtifact("groundingReport", groundingReport);
    }

    let surfaceReport: LayerReport;
    if (hasArtifact("surfaceReport") && hadGeneratedContent && !forced(5)) {
      surfaceReport = loadArtifact<LayerReport>("surfaceReport");
      recordLayerRun(manifest, surfaceReport, "RESUMED from disk, $0 this run");
      console.log("  RESUMED: surface-report.json loaded ($0)");
    } else {
      surfaceReport = await computeSurfaceLayer(surfaceItems);
      spend.add("surface-layer-reported", surfaceReport.totalCostUsd);
      spend.assertUnderCap();
      recordLayerRun(manifest, surfaceReport, `${surfaceItems.length} generated items, silver reference = top-1 retrieved chunk`);
      writeArtifact("surfaceReport", surfaceReport);
    }

    console.log("[6/6] pedagogical (cross-family judge panel)...");
    // RAW-SCORE PERSISTENCE FIX: resuming requires BOTH the folded report AND
    // the raw per-(item,judge,dimension) scores -- a report alone cannot be
    // un-folded back into per-judge scores, so kappa could never be
    // recomputed from it. hasArtifact("pedagogicalRaw") gates resumption the
    // same way buildResumePlan()'s step6 does.
    if (hasArtifact("pedagogicalReport") && hasArtifact("pedagogicalRaw") && hadGeneratedContent && !forced(6)) {
      const pedagogicalReport = loadArtifact<LayerReport & { agreement?: unknown }>("pedagogicalReport");
      recordLayerRun(manifest, pedagogicalReport, "RESUMED from disk, $0 this run");
      console.log("  RESUMED: pedagogical-report.json + pedagogical-raw-scores.json loaded ($0)");
    } else {
      if (forced(6)) {
        console.log("  --force-steps includes 6 -- re-running the judge panel, ignoring cached pedagogical artifacts");
      }
      outer: for (const s of states) {
        if (!s.generatedText) continue;
        const evalItem: EvalItemInput = {
          itemId: s.query.id,
          scenarioId: s.query.topic,
          goalpostTitle: s.query.query,
          goalpostObjective: `The learner can explain: ${s.query.query}`,
          informationContent: s.topContextChunks.map((c) => c.text).join("\n\n"),
          experiencePrompt: `Explain what you now understand about: ${s.query.query}`,
          artifact: s.generatedText,
        };
        for (const judge of JUDGE_PANEL) {
          const t0 = Date.now();
          try {
            const res = await runKc(judge, evalItem);
            const usd = usdFor(judge, res.inputTokens, res.outputTokens);
            spend.add(`judge:${judge.key}`, usd);
            pedagogicalScores.push({
              itemId: s.query.id,
              judgeKey: judge.key,
              dimensionScores: res.scores ?? {},
              inputTokens: res.inputTokens,
              outputTokens: res.outputTokens,
              latencyMs: res.latencyMs,
              model: judge.model,
            });
            spend.assertUnderCap();
          } catch (e) {
            if (e instanceof SpendCapExceededError) throw e;
            console.log(`  ! judge ${judge.key} failed on ${s.query.id} (${Date.now() - t0}ms): ${(e as Error).message.slice(0, 200)}`);
          }
        }
      }
      // RAW-SCORE PERSISTENCE FIX: write every per-(item,judge,dimension)
      // score to disk BEFORE aggregation/folding. computePedagogicalLayer's
      // fold only keeps a cross-judge MEAN per item (see pedagogical.ts's
      // foldPedagogicalItem), which cannot be un-folded back into per-judge
      // scores -- this was the exact gap QA flagged (2026-08-07 CONDITIONAL
      // sign-off): kappa could not be computed at all because this array
      // never reached disk.
      writeArtifact("pedagogicalRaw", pedagogicalScores);
      const foldedReport = computePedagogicalLayer(pedagogicalScores);
      const agreement = computePedagogicalAgreement(pedagogicalScores);
      const pedagogicalReport = { ...foldedReport, agreement };
      recordLayerRun(manifest, foldedReport, `${pedagogicalScores.length} (item,judge) scores, ${JUDGE_PANEL.length}-model panel, kappa computed`);
      writeArtifact("pedagogicalReport", pedagogicalReport);
    }

    // external: stub invocation, no live data (out of scope, see external.ts TODO).
    const externalReport = computeExternalLayer([]);
    recordLayerSkipped(manifest, "external", "TutorEval/MathTutorBench dataset download out of scope for E05 (see layers/external.ts TODO)");
    writeFileSync(join(OUT_DIR, "external-report.json"), JSON.stringify(externalReport, null, 2));
  } catch (e) {
    if (e instanceof SpendCapExceededError) {
      aborted = true;
      abortReason = e.message;
      console.error(e.message);
    } else {
      throw e;
    }
  }

  finalizeManifest(manifest, aborted ? `ABORTED: ${abortReason}` : "completed");
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

  // qrels.json / generated-content.json are now checkpointed as soon as
  // their own step finishes (see above), not just here at the end -- this
  // final block only writes the run-level summary artifacts.
  const costSummary = {
    generatedAt: new Date().toISOString(),
    capUsd: COST_CAP_USD,
    totalUsd: Number(spend.total.toFixed(6)),
    aborted,
    abortReason,
    breakdown: Object.fromEntries(Object.entries(spend.breakdown).map(([k, v]) => [k, Number(v.toFixed(6))])),
  };
  writeFileSync(join(OUT_DIR, "cost-summary.json"), JSON.stringify(costSummary, null, 2));

  console.log("");
  console.log(`Done. aborted=${aborted}. Spend: $${spend.total.toFixed(4)} / cap $${COST_CAP_USD}`);
  console.table(costSummary.breakdown);
  console.log(`Manifest: ${join(OUT_DIR, "manifest.json")}`);
  console.log(`Cost summary: ${join(OUT_DIR, "cost-summary.json")}`);
  if (aborted) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
