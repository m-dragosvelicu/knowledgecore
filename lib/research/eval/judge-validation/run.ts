/**
 * Judge-validation run orchestrator.
 *
 * Executes, over one designed-tier corpus:
 *   1. The KnowledgeCore rubric under THREE different judge model families
 *      (inter-judge agreement, the substitute for a second human rater).
 *   2. Three repeated runs of the production judge at the production
 *      temperature (self-consistency, the substitute for intra-rater
 *      reliability).
 *   3. The three alternative evaluation approaches on the same items.
 *   4. A deterministic perturbation battery whose items MUST score lower than
 *      the artifact they were degraded from.
 *
 * Writes one JSONL record per (system, judge, replicate, item) so a crash loses
 * at most one call, and a re-run resumes by skipping keys already present.
 * Aborts hard on the spend cap rather than silently continuing.
 *
 * Run:
 *   bun run lib/research/eval/judge-validation/run.ts [--cap-usd 8] [--out DIR]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { SCENARIOS, TIER_LABELS, MASTERY_TIER } from "./corpus";
import { PERTURBATIONS, buildBattery } from "./perturb";
import { JUDGE_PANEL, PRIMARY_JUDGE, usdFor, type JudgeModel } from "./providers";
import {
  cosine,
  embedTexts,
  runBareRubric,
  runHolistic,
  runKc,
  SIMILARITY_MODEL,
  SIMILARITY_PRICE_PER_MTOK_USD,
  type EvalItemInput,
  type SystemId,
  type SystemOutput,
} from "./systems";

// --- .env loading -----------------------------------------------------------
// bun auto-loads .env from the CWD, but this script is often invoked from a
// different directory, so load the repo-root .env explicitly and never
// overwrite a variable already present in the real environment.
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

// fileURLToPath rather than Bun's import.meta.dir: the latter is not declared
// on ImportMeta in the repo's TS lib and fails `bun run typecheck`.
const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
loadEnv(REPO_ROOT);

// --- args -------------------------------------------------------------------
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const CAP_USD = Number(arg("cap-usd", "8"));
const OUT_DIR = arg(
  "out",
  "/Users/dragosvelicu/Documents/_hq/work/papers-for-professor/licenta-knowledgecore/raw-results/judge-validation-2026-07-31",
);
const REPLICATES = Number(arg("replicates", "3"));
const CONCURRENCY = Number(arg("concurrency", "4"));

mkdirSync(OUT_DIR, { recursive: true });
const RECORDS_PATH = join(OUT_DIR, "records.jsonl");

// --- corpus assembly --------------------------------------------------------

export interface CorpusItem extends EvalItemInput {
  kind: "tier" | "perturbation";
  /** Designed quality tier 0-3 for base items; the parent's tier for perturbed. */
  tier: number;
  tierLabel: string;
  perturbation: string | null;
  /** itemId of the artifact this was degraded from, for perturbed items. */
  parentItemId: string | null;
  domain: "technical" | "soft";
}

function buildCorpus(): CorpusItem[] {
  const items: CorpusItem[] = [];

  for (const s of SCENARIOS) {
    s.artifacts.forEach((artifact, tier) => {
      items.push({
        itemId: `${s.id}__T${tier}`,
        kind: "tier",
        tier,
        tierLabel: TIER_LABELS[tier],
        perturbation: null,
        parentItemId: null,
        domain: s.domain,
        scenarioId: s.id,
        goalpostTitle: s.goalpostTitle,
        goalpostObjective: s.goalpostObjective,
        informationContent: s.informationContent,
        experiencePrompt: s.experiencePrompt,
        artifact,
      });
    });
  }

  // Perturbations degrade the MASTERY artifact, so any score drop is
  // unambiguous: there is no floor effect to hide behind.
  SCENARIOS.forEach((s, idx) => {
    // Donor for the off-topic splice is the NEXT scenario, wrapping around, so
    // the donor is always a different subject and the mapping is deterministic.
    const donor = SCENARIOS[(idx + 1) % SCENARIOS.length];
    const battery = buildBattery({
      masteryText: s.artifacts[MASTERY_TIER],
      termSwaps: s.termSwaps,
      specifics: s.specifics,
      donorText: donor.artifacts[MASTERY_TIER],
    });
    for (const p of battery) {
      items.push({
        itemId: `${s.id}__P_${p.perturbation}`,
        kind: "perturbation",
        tier: MASTERY_TIER,
        tierLabel: `perturbed from ${TIER_LABELS[MASTERY_TIER]}`,
        perturbation: p.perturbation,
        parentItemId: `${s.id}__T${MASTERY_TIER}`,
        domain: s.domain,
        scenarioId: s.id,
        goalpostTitle: s.goalpostTitle,
        goalpostObjective: s.goalpostObjective,
        informationContent: s.informationContent,
        experiencePrompt: s.experiencePrompt,
        artifact: p.text,
      });
    }
  });

  return items;
}

// --- spend accounting -------------------------------------------------------

class SpendTracker {
  private byProvider = new Map<string, number>();
  constructor(private readonly capUsd: number) {}
  add(key: string, usd: number): void {
    this.byProvider.set(key, (this.byProvider.get(key) ?? 0) + usd);
  }
  get total(): number {
    let t = 0;
    for (const v of this.byProvider.values()) t += v;
    return t;
  }
  get breakdown(): Record<string, number> {
    return Object.fromEntries([...this.byProvider.entries()].map(([k, v]) => [k, Number(v.toFixed(6))]));
  }
  assertUnderCap(): void {
    if (this.total > this.capUsd) {
      throw new Error(
        `SPEND CAP EXCEEDED: ${this.total.toFixed(4)} USD > cap ${this.capUsd} USD. Aborting run.`,
      );
    }
  }
}

const spend = new SpendTracker(CAP_USD);

// --- deterministic job-order shuffle (E05 bias mitigation) ------------------
// Named mulberry32 rather than Math.random for the same reason perturb.ts and
// stats.ts use it: a fixed seed makes the executed order reproducible from
// this file alone, while still decorrelating job order from any fixed
// judge/item serial position (see the BIAS MITIGATIONS note in providers.ts).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const JOB_ORDER_SEED = 20260807;
function seededShuffle<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- record IO --------------------------------------------------------------

export interface RunRecord {
  key: string;
  system: SystemId;
  judgeKey: string;
  replicate: number;
  itemId: string;
  scenarioId: string;
  domain: string;
  kind: string;
  tier: number;
  perturbation: string | null;
  parentItemId: string | null;
  ok: boolean;
  error: string | null;
  normalizedScore: number | null;
  scores: Record<string, number> | null;
  decision: string | null;
  evidenceVerifiedRate: number | null;
  evidenceCount: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  usd: number;
  raw: unknown;
  ts: string;
}

function loadExistingKeys(): Set<string> {
  if (!existsSync(RECORDS_PATH)) return new Set();
  const keys = new Set<string>();
  for (const line of readFileSync(RECORDS_PATH, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as RunRecord;
      // Only successful records count as done; a failure is retried on re-run.
      if (r.ok) keys.add(r.key);
    } catch {
      // A torn final line from a hard kill is ignored rather than fatal.
    }
  }
  return keys;
}

function writeRecord(r: RunRecord): void {
  appendFileSync(RECORDS_PATH, JSON.stringify(r) + "\n");
}

// --- job planning -----------------------------------------------------------

interface Job {
  key: string;
  system: SystemId;
  judge: JudgeModel;
  replicate: number;
  item: CorpusItem;
}

function planJobs(items: CorpusItem[]): Job[] {
  const jobs: Job[] = [];

  // 1. Inter-judge: the KC rubric under every panel model, replicate 1.
  for (const judge of JUDGE_PANEL) {
    for (const item of items) {
      jobs.push({ key: `kc|${judge.key}|1|${item.itemId}`, system: "kc", judge, replicate: 1, item });
    }
  }

  // 2. Self-consistency: extra replicates of the PRODUCTION judge only.
  for (let rep = 2; rep <= REPLICATES; rep++) {
    for (const item of items) {
      jobs.push({
        key: `kc|${PRIMARY_JUDGE.key}|${rep}|${item.itemId}`,
        system: "kc",
        judge: PRIMARY_JUDGE,
        replicate: rep,
        item,
      });
    }
  }

  // 3. Alternatives A and B on the production judge, replicate 1.
  for (const system of ["alt_a_holistic", "alt_b_bare"] as const) {
    for (const item of items) {
      jobs.push({
        key: `${system}|${PRIMARY_JUDGE.key}|1|${item.itemId}`,
        system,
        judge: PRIMARY_JUDGE,
        replicate: 1,
        item,
      });
    }
  }

  return jobs;
}

async function runJob(job: Job): Promise<SystemOutput> {
  switch (job.system) {
    case "kc":
      return runKc(job.judge, job.item);
    case "alt_a_holistic":
      return runHolistic(job.judge, job.item);
    case "alt_b_bare":
      return runBareRubric(job.judge, job.item);
    default:
      throw new Error(`no LLM runner for system ${job.system}`);
  }
}

// --- ALT-C: deterministic similarity baseline -------------------------------

async function runSimilarityBaseline(items: CorpusItem[]): Promise<RunRecord[]> {
  console.log(`[alt_c] embedding ${items.length} artifacts + ${SCENARIOS.length} references with ${SIMILARITY_MODEL}`);
  const refs = await embedTexts(SCENARIOS.map((s) => s.referenceAnswer));
  const refByScenario = new Map(SCENARIOS.map((s, i) => [s.id, refs.vectors[i]]));

  const arts = await embedTexts(items.map((i) => i.artifact));

  // Gemini embedding is priced per input token. Token counts are not returned
  // by embedContent, so the character/4 approximation is used and LABELLED as
  // an approximation. It is the only estimated figure in this study.
  const approxTokens =
    Math.ceil(
      [...items.map((i) => i.artifact), ...SCENARIOS.map((s) => s.referenceAnswer)]
        .reduce((a, t) => a + t.length, 0) / 4,
    );
  const usd = (approxTokens / 1_000_000) * SIMILARITY_PRICE_PER_MTOK_USD;
  spend.add(`google:${SIMILARITY_MODEL}`, usd);

  const out: RunRecord[] = [];
  items.forEach((item, i) => {
    const ref = refByScenario.get(item.scenarioId);
    const sim = ref ? cosine(arts.vectors[i], ref) : 0;
    out.push({
      key: `alt_c_similarity|${SIMILARITY_MODEL}|1|${item.itemId}`,
      system: "alt_c_similarity",
      judgeKey: SIMILARITY_MODEL,
      replicate: 1,
      itemId: item.itemId,
      scenarioId: item.scenarioId,
      domain: item.domain,
      kind: item.kind,
      tier: item.tier,
      perturbation: item.perturbation,
      parentItemId: item.parentItemId,
      ok: true,
      error: null,
      // Raw cosine scaled to 0-100. NOT calibrated against the 0-4 rubric: the
      // metrics that use it (Spearman, strict-drop rate) are rank-based and
      // therefore invariant to this monotone rescaling.
      normalizedScore: sim * 100,
      scores: null,
      decision: null,
      evidenceVerifiedRate: null,
      evidenceCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: arts.latencyMs[i],
      usd: 0,
      raw: { cosine: sim, note: "decision threshold assigned at analysis time" },
      ts: new Date().toISOString(),
    });
  });
  console.log(`[alt_c] done. approx ${approxTokens} tokens, ${usd.toFixed(5)} USD`);
  return out;
}

// --- main -------------------------------------------------------------------

async function main() {
  const items = buildCorpus();
  const done = loadExistingKeys();
  // Shuffle before filtering-done so a resumed run's remaining jobs are still
  // in a decorrelated order, not just the tail of the original plan order.
  const jobs = seededShuffle(planJobs(items), JOB_ORDER_SEED).filter((j) => !done.has(j.key));

  console.log(`Corpus: ${items.length} items (${SCENARIOS.length} scenarios x 4 tiers + ${SCENARIOS.length} x ${PERTURBATIONS.length} perturbations)`);
  console.log(`Jobs: ${jobs.length} pending (${done.size} already complete)`);
  console.log(`Spend cap: ${CAP_USD} USD. Concurrency: ${CONCURRENCY}.`);

  writeFileSync(
    join(OUT_DIR, "corpus.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        scenarios: SCENARIOS.map((s) => ({
          id: s.id,
          domain: s.domain,
          goalpostTitle: s.goalpostTitle,
          goalpostObjective: s.goalpostObjective,
        })),
        perturbations: PERTURBATIONS,
        items,
      },
      null,
      2,
    ),
  );

  let completed = 0;
  let failed = 0;
  let aborted = false;
  const queue = jobs.slice();

  async function worker(id: number): Promise<void> {
    while (!aborted) {
      const job = queue.shift();
      if (!job) return;
      const base = {
        key: job.key,
        system: job.system,
        judgeKey: job.judge.key,
        replicate: job.replicate,
        itemId: job.item.itemId,
        scenarioId: job.item.scenarioId,
        domain: job.item.domain,
        kind: job.item.kind,
        tier: job.item.tier,
        perturbation: job.item.perturbation,
        parentItemId: job.item.parentItemId,
        ts: new Date().toISOString(),
      };
      try {
        const res = await runJob(job);
        const usd = usdFor(job.judge, res.inputTokens, res.outputTokens);
        spend.add(`${job.judge.provider}:${job.judge.model}`, usd);
        writeRecord({
          ...base,
          ok: true,
          error: null,
          normalizedScore: res.normalizedScore,
          scores: res.scores,
          decision: res.decision,
          evidenceVerifiedRate: res.evidenceVerifiedRate,
          evidenceCount: res.evidenceCount,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          latencyMs: res.latencyMs,
          usd,
          raw: res.raw,
        });
        completed++;
        try {
          spend.assertUnderCap();
        } catch (capErr) {
          aborted = true;
          console.error((capErr as Error).message);
          return;
        }
      } catch (err) {
        failed++;
        // A failure is RECORDED, never swallowed. The analysis reports the
        // failure rate per system and judge.
        writeRecord({
          ...base,
          ok: false,
          error: (err as Error).message.slice(0, 500),
          normalizedScore: null,
          scores: null,
          decision: null,
          evidenceVerifiedRate: null,
          evidenceCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          usd: 0,
          raw: null,
        });
        console.log(`  ! FAIL ${job.key}: ${(err as Error).message.slice(0, 160)}`);
      }
      if ((completed + failed) % 20 === 0) {
        console.log(
          `  progress ${completed + failed}/${jobs.length} (ok ${completed}, fail ${failed}) spend ${spend.total.toFixed(4)} USD`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

  if (!aborted) {
    const simRecords = await runSimilarityBaseline(items);
    const existing = loadExistingKeys();
    for (const r of simRecords) if (!existing.has(r.key)) writeRecord(r);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    aborted,
    corpusItems: items.length,
    jobsPlanned: jobs.length,
    jobsOk: completed,
    jobsFailed: failed,
    replicates: REPLICATES,
    productionTemperature: 0.2,
    judgePanel: JUDGE_PANEL.map((j) => ({
      key: j.key,
      label: j.label,
      provider: j.provider,
      model: j.model,
      inputPerMTokUsd: j.inputPerMTokUsd,
      outputPerMTokUsd: j.outputPerMTokUsd,
      priceSource: j.priceSource,
    })),
    spendUsdThisRun: Number(spend.total.toFixed(5)),
    spendBreakdownThisRun: spend.breakdown,
    capUsd: CAP_USD,
  };
  writeFileSync(join(OUT_DIR, "run-manifest.json"), JSON.stringify(manifest, null, 2));

  console.log("");
  console.log(`Done. ok=${completed} fail=${failed} aborted=${aborted}`);
  console.log(`Spend this run: ${spend.total.toFixed(4)} USD`, spend.breakdown);
  console.log(`Records: ${RECORDS_PATH}`);
  if (aborted) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
