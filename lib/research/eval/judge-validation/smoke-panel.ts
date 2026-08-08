/**
 * Cross-family judge-panel smoke test (E05, pedagogical layer).
 *
 * Scores a SMALL, fixed subset of the designed corpus (3 items, not the full
 * 54-item study already run and reported 2026-07-31/2026-08-04) with the full
 * JUDGE_PANEL (Gemini + GPT-5.4-mini + Claude Sonnet 5, three model families),
 * then computes both agreement statistics the CEO-ratified report names:
 *   - pairwise quadratic-weighted Cohen's kappa per dimension (stats.ts,
 *     already existed)
 *   - Fleiss' kappa across the whole panel per dimension (stats.ts, added by
 *     this change)
 *
 * This is a wiring/cost smoke test, not a validation run: n=3 is far too
 * small for a trustworthy kappa estimate (both functions will legitimately
 * return small-sample or degenerate values on several dimensions) and the
 * result here must never be cited as a reliability figure. Its only purpose
 * is to prove the panel + new stats path executes end-to-end under a hard
 * spend cap before any full run is authorized.
 *
 * Bias mitigations in effect (see providers.ts and run.ts for the persistent
 * notes): judges are called independently with no shared context and never
 * see another judge's score; item x judge job order is seed-shuffled before
 * dispatch; the corpus artifacts are human-authored, so no panel judge is
 * scoring its own family's output (self-preference does not apply here, but
 * would need to be re-examined before running a panel over LLM-generated
 * content).
 *
 * Run: bun run lib/research/eval/judge-validation/smoke-panel.ts [--cap-usd 1]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { SCENARIOS, TIER_LABELS } from "./corpus";
import { JUDGE_PANEL, usdFor } from "./providers";
import { DIMENSIONS, runKc, type Dimension, type EvalItemInput } from "./systems";
import { fleissKappa, quadraticWeightedKappa, type Maybe } from "./stats";

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
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
loadEnv(REPO_ROOT);

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const CAP_USD = Number(arg("cap-usd", "1"));
const OUT_DIR = arg(
  "out",
  "/Users/dragosvelicu/Documents/_hq/work/papers-for-professor/licenta-knowledgecore/raw-results/judge-panel-smoke-2026-08-07",
);
mkdirSync(OUT_DIR, { recursive: true });

// Fixed 3-item subset, spread across quality tiers and two different
// scenarios so the smoke test is not trivially degenerate (all-same-score).
function buildSmokeItems(): (EvalItemInput & { tierLabel: string })[] {
  const s0 = SCENARIOS[0];
  const s1 = SCENARIOS[1];
  return [
    { id: `${s0.id}__T0`, scenario: s0, tier: 0 },
    { id: `${s0.id}__T3`, scenario: s0, tier: 3 },
    { id: `${s1.id}__T2`, scenario: s1, tier: 2 },
  ].map(({ id, scenario, tier }) => ({
    itemId: id,
    scenarioId: scenario.id,
    goalpostTitle: scenario.goalpostTitle,
    goalpostObjective: scenario.goalpostObjective,
    informationContent: scenario.informationContent,
    experiencePrompt: scenario.experiencePrompt,
    artifact: scenario.artifacts[tier],
    tierLabel: TIER_LABELS[tier],
  }));
}

// Same seeded shuffle as run.ts, applied here to the (judge, item) job list.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface SmokeRecord {
  itemId: string;
  tierLabel: string;
  judgeKey: string;
  ok: boolean;
  error: string | null;
  scores: Record<Dimension, number> | null;
  decision: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  usd: number;
}

async function main() {
  const items = buildSmokeItems();
  const jobs = seededShuffle(
    JUDGE_PANEL.flatMap((judge) => items.map((item) => ({ judge, item }))),
    20260807,
  );

  console.log(`Smoke test: ${items.length} items x ${JUDGE_PANEL.length} judges = ${jobs.length} calls. Cap ${CAP_USD} USD.`);

  let spend = 0;
  const records: SmokeRecord[] = [];
  for (const job of jobs) {
    try {
      const res = await runKc(job.judge, job.item);
      const usd = usdFor(job.judge, res.inputTokens, res.outputTokens);
      spend += usd;
      records.push({
        itemId: job.item.itemId,
        tierLabel: (job.item as EvalItemInput & { tierLabel: string }).tierLabel,
        judgeKey: job.judge.key,
        ok: true,
        error: null,
        scores: res.scores,
        decision: res.decision,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        latencyMs: res.latencyMs,
        usd,
      });
      console.log(`  ok  ${job.item.itemId} / ${job.judge.key}  scores=${JSON.stringify(res.scores)} decision=${res.decision} usd=${usd.toFixed(5)}`);
    } catch (err) {
      records.push({
        itemId: job.item.itemId,
        tierLabel: (job.item as EvalItemInput & { tierLabel: string }).tierLabel,
        judgeKey: job.judge.key,
        ok: false,
        error: (err as Error).message.slice(0, 300),
        scores: null,
        decision: null,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        usd: 0,
      });
      console.log(`  FAIL ${job.item.itemId} / ${job.judge.key}: ${(err as Error).message.slice(0, 200)}`);
    }
    if (spend > CAP_USD) {
      console.error(`SPEND CAP EXCEEDED: ${spend.toFixed(4)} USD > cap ${CAP_USD} USD. Aborting.`);
      break;
    }
  }

  // Agreement stats: only over items where every judge produced a usable score.
  const byItem = new Map<string, Map<string, Record<Dimension, number>>>();
  for (const r of records) {
    if (!r.ok || !r.scores) continue;
    if (!byItem.has(r.itemId)) byItem.set(r.itemId, new Map());
    byItem.get(r.itemId)!.set(r.judgeKey, r.scores);
  }
  const panelKeys = JUDGE_PANEL.map((j) => j.key);
  const completeItemIds = [...byItem.keys()].filter((id) => panelKeys.every((k) => byItem.get(id)!.has(k)));

  const perDimension: Record<
    string,
    { pairwiseCohenQwk: { pair: string; kappa: Maybe; n: number }[]; fleiss: Maybe; fleissN: number }
  > = {};
  for (const dim of DIMENSIONS) {
    const pairwise: { pair: string; kappa: Maybe; n: number }[] = [];
    for (let i = 0; i < panelKeys.length; i++) {
      for (let j = i + 1; j < panelKeys.length; j++) {
        const a = completeItemIds.map((id) => byItem.get(id)!.get(panelKeys[i])![dim]);
        const b = completeItemIds.map((id) => byItem.get(id)!.get(panelKeys[j])![dim]);
        const k = quadraticWeightedKappa(a, b, 0, 4);
        pairwise.push({ pair: `${panelKeys[i]} vs ${panelKeys[j]}`, kappa: k.value, n: k.n });
      }
    }
    const ratings = completeItemIds.map((id) => panelKeys.map((k) => byItem.get(id)!.get(k)![dim]));
    const fl = fleissKappa(ratings, 0, 4);
    perDimension[dim] = { pairwiseCohenQwk: pairwise, fleiss: fl.value, fleissN: fl.n };
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    note:
      "SMOKE TEST, n=3 items. Kappa values here are a wiring proof, not a reliability estimate; do not cite these numbers in the thesis or the eval report. The full-corpus panel run this extends is lib/research/eval/judge-validation/run.ts (already executed 2026-07-31, see analyze.ts for the citable inter-judge agreement figures).",
    items: items.map((i) => ({ itemId: i.itemId, tierLabel: i.tierLabel })),
    judgePanel: JUDGE_PANEL.map((j) => ({ key: j.key, label: j.label, provider: j.provider, model: j.model })),
    completeItems: completeItemIds.length,
    spendUsd: Number(spend.toFixed(5)),
    capUsd: CAP_USD,
    perDimension,
    records,
  };
  writeFileSync(join(OUT_DIR, "smoke-summary.json"), JSON.stringify(summary, null, 2));

  console.log("");
  console.log(`Done. ${records.filter((r) => r.ok).length}/${records.length} calls ok. Spend ${spend.toFixed(4)} USD.`);
  console.log(`Complete items (all 3 judges scored): ${completeItemIds.length}/${items.length}`);
  console.log(`Summary: ${join(OUT_DIR, "smoke-summary.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
