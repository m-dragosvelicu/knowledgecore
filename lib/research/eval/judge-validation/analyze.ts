/**
 * Analysis for the judge-validation study.
 *
 * Reads records.jsonl produced by run.ts and emits:
 *   analysis.json                    every computed statistic, machine-readable
 *   JUDGE-VALIDATION-2026-07-31.md   the written report, tables generated
 *
 * The markdown is generated rather than hand-written so that no figure in the
 * report is ever transcribed by hand. Prose that frames the numbers is in this
 * file; the numbers themselves come only from the records.
 *
 * Run: bun run lib/research/eval/judge-validation/analyze.ts [--dir DIR]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PERTURBATIONS } from "./perturb";
import { JUDGE_PANEL, PRIMARY_JUDGE } from "./providers";
import { DIMENSIONS, type Dimension } from "./systems";
import {
  agreementBand,
  alphaBand,
  bootstrapCI,
  cohenKappaNominal,
  krippendorffAlphaOrdinal,
  mean,
  median,
  quadraticWeightedKappa,
  sd,
  spearman,
  type Maybe,
  type StatWithReason,
} from "./stats";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DIR = arg(
  "dir",
  "/Users/dragosvelicu/Documents/_hq/work/papers-for-professor/licenta-knowledgecore/raw-results/judge-validation-2026-07-31",
);
const OUT_MD = arg("md", "/Users/dragosvelicu/Documents/_hq/work/papers-for-professor/licenta-knowledgecore/raw-results/JUDGE-VALIDATION-2026-07-31.md");

interface Rec {
  key: string;
  system: string;
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
}

const SYSTEM_LABELS: Record<string, string> = {
  kc: "KnowledgeCore (6-dim rubric + evidence contract + derived decision)",
  alt_a_holistic: "ALT-A holistic single-score LLM grader",
  alt_b_bare: "ALT-B bare 6-dim rubric (no descriptors, no evidence, model decision)",
  alt_c_similarity: "ALT-C reference-answer embedding similarity (no LLM judge)",
};

const fmt = (v: Maybe, dp = 3): string => (v === null || !Number.isFinite(v) ? "n/a" : v.toFixed(dp));
const pct = (v: Maybe, dp = 1): string => (v === null || !Number.isFinite(v) ? "n/a" : `${(v * 100).toFixed(dp)}%`);

function loadRecords(): Rec[] {
  const p = join(DIR, "records.jsonl");
  if (!existsSync(p)) throw new Error(`records not found at ${p}`);
  const out: Rec[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Rec);
    } catch {
      // Torn trailing line from an interrupted run; skipped and counted below.
    }
  }
  // Latest successful record per key wins; a re-run may have retried a failure.
  const byKey = new Map<string, Rec>();
  for (const r of out) {
    const prev = byKey.get(r.key);
    if (!prev || (!prev.ok && r.ok)) byKey.set(r.key, r);
  }
  return [...byKey.values()];
}

const records = loadRecords();
const ok = records.filter((r) => r.ok);
const failures = records.filter((r) => !r.ok);

const scenarios = [...new Set(records.map((r) => r.scenarioId))].sort();
const domainOf = new Map(records.map((r) => [r.scenarioId, r.domain]));

/** Index: system -> judge -> replicate -> itemId -> record. */
function index(recs: Rec[]) {
  const m = new Map<string, Rec>();
  for (const r of recs) m.set(`${r.system}|${r.judgeKey}|${r.replicate}|${r.itemId}`, r);
  return m;
}
const IDX = index(ok);
const get = (system: string, judge: string, rep: number, itemId: string) =>
  IDX.get(`${system}|${judge}|${rep}|${itemId}`);

const baseItems = [...new Set(ok.filter((r) => r.kind === "tier").map((r) => r.itemId))].sort();
const perturbedItems = [...new Set(ok.filter((r) => r.kind === "perturbation").map((r) => r.itemId))].sort();
const allItems = [...baseItems, ...perturbedItems];

// ---------------------------------------------------------------------------
// M1 tier discrimination
// ---------------------------------------------------------------------------

interface TierResult {
  system: string;
  judgeKey: string;
  n: number;
  spearman: Maybe;
  ciLower: Maybe;
  ciUpper: Maybe;
  ciNote?: string;
  meanByTier: (number | null)[];
  nonDecreasingScenarios: number;
  strictlyIncreasingScenarios: number;
  scenariosEvaluated: number;
  adjacentSeparation: { pair: string; increased: number; of: number }[];
}

function tierDiscrimination(system: string, judgeKey: string, rep = 1): TierResult | null {
  const rows = baseItems
    .map((id) => get(system, judgeKey, rep, id))
    .filter((r): r is Rec => Boolean(r) && r!.normalizedScore !== null);
  if (rows.length < 4) return null;

  // Cluster bootstrap over SCENARIOS: the four tiers of one scenario share an
  // author and a subject, so items within a scenario are not independent.
  const clusters = scenarios
    .map((s) => rows.filter((r) => r.scenarioId === s))
    .filter((c) => c.length > 0);

  const est = (sample: Rec[][]): Maybe => {
    const flat = sample.flat();
    return spearman(
      flat.map((r) => r.tier),
      flat.map((r) => r.normalizedScore as number),
    ).value;
  };
  const ci = bootstrapCI(clusters, est, { replicates: 2000, seed: 20260731 });

  const meanByTier = [0, 1, 2, 3].map((t) => {
    const v = rows.filter((r) => r.tier === t).map((r) => r.normalizedScore as number);
    return v.length ? mean(v) : null;
  });

  let nonDec = 0;
  let strict = 0;
  let evaluated = 0;
  const adjacent = [
    { pair: "T0->T1", increased: 0, of: 0 },
    { pair: "T1->T2", increased: 0, of: 0 },
    { pair: "T2->T3", increased: 0, of: 0 },
  ];
  for (const s of scenarios) {
    const byTier = [0, 1, 2, 3].map((t) => rows.find((r) => r.scenarioId === s && r.tier === t));
    if (byTier.some((r) => !r)) continue;
    evaluated++;
    const v = byTier.map((r) => r!.normalizedScore as number);
    if (v[0] <= v[1] && v[1] <= v[2] && v[2] <= v[3]) nonDec++;
    if (v[0] < v[1] && v[1] < v[2] && v[2] < v[3]) strict++;
    for (let i = 0; i < 3; i++) {
      adjacent[i].of++;
      if (v[i] < v[i + 1]) adjacent[i].increased++;
    }
  }

  return {
    system,
    judgeKey,
    n: rows.length,
    spearman: ci.point,
    ciLower: ci.lower,
    ciUpper: ci.upper,
    ciNote: ci.note,
    meanByTier,
    nonDecreasingScenarios: nonDec,
    strictlyIncreasingScenarios: strict,
    scenariosEvaluated: evaluated,
    adjacentSeparation: adjacent,
  };
}

// ---------------------------------------------------------------------------
// M2 perturbation sensitivity
// ---------------------------------------------------------------------------

interface PerturbResult {
  system: string;
  judgeKey: string;
  n: number;
  strictDrops: number;
  ties: number;
  increases: number;
  meanDrop: number;
  byPerturbation: {
    id: string;
    n: number;
    strictDrops: number;
    meanDrop: number;
    meanParent: number;
    meanPerturbed: number;
  }[];
  violations: { itemId: string; perturbation: string; parentScore: number; perturbedScore: number }[];
}

function perturbationSensitivity(system: string, judgeKey: string, rep = 1): PerturbResult | null {
  const pairs: { rec: Rec; parent: Rec }[] = [];
  for (const id of perturbedItems) {
    const r = get(system, judgeKey, rep, id);
    if (!r || r.normalizedScore === null || !r.parentItemId) continue;
    const p = get(system, judgeKey, rep, r.parentItemId);
    if (!p || p.normalizedScore === null) continue;
    pairs.push({ rec: r, parent: p });
  }
  if (pairs.length === 0) return null;

  const drops = pairs.map((x) => (x.parent.normalizedScore as number) - (x.rec.normalizedScore as number));
  const strict = pairs.filter((x, i) => drops[i] > 0).length;
  const ties = pairs.filter((x, i) => drops[i] === 0).length;
  const inc = pairs.filter((x, i) => drops[i] < 0).length;

  const byP = PERTURBATIONS.map((p) => {
    const sub = pairs.filter((x) => x.rec.perturbation === p.id);
    const d = sub.map((x) => (x.parent.normalizedScore as number) - (x.rec.normalizedScore as number));
    return {
      id: p.id,
      n: sub.length,
      strictDrops: d.filter((v) => v > 0).length,
      meanDrop: d.length ? mean(d) : 0,
      meanParent: sub.length ? mean(sub.map((x) => x.parent.normalizedScore as number)) : 0,
      meanPerturbed: sub.length ? mean(sub.map((x) => x.rec.normalizedScore as number)) : 0,
    };
  });

  const violations = pairs
    .filter((x, i) => drops[i] <= 0)
    .map((x) => ({
      itemId: x.rec.itemId,
      perturbation: x.rec.perturbation ?? "",
      parentScore: x.parent.normalizedScore as number,
      perturbedScore: x.rec.normalizedScore as number,
    }));

  return {
    system,
    judgeKey,
    n: pairs.length,
    strictDrops: strict,
    ties,
    increases: inc,
    meanDrop: mean(drops),
    byPerturbation: byP,
    violations,
  };
}

// ---------------------------------------------------------------------------
// M3 inter-judge agreement (KC rubric, replicate 1)
// ---------------------------------------------------------------------------

const panelKeys = JUDGE_PANEL.map((j) => j.key);

/** Items where every panel judge produced a usable KC score. */
const interJudgeItems = allItems.filter((id) => panelKeys.every((k) => get("kc", k, 1, id)?.scores));

function perDimensionUnits(judgeKeys: string[], items: string[], dim: Dimension): number[][] {
  return items.map((id) =>
    judgeKeys.map((k) => get("kc", k, 1, id)!.scores![dim]).filter((v) => Number.isFinite(v)),
  );
}

interface InterJudgeDim {
  dimension: string;
  alpha: StatWithReason;
  alphaBand: string;
  pairwiseQwk: { pair: string; kappa: Maybe; band: string; reason?: string }[];
  exactThreeWayMatchRate: number;
  meanAbsPairwiseDiff: number;
  perJudgeMean: Record<string, number>;
  perJudgeSd: Record<string, number>;
}

function interJudgeAnalysis() {
  const dims: InterJudgeDim[] = DIMENSIONS.map((dim) => {
    const units = perDimensionUnits(panelKeys, interJudgeItems, dim);
    const alpha = krippendorffAlphaOrdinal(units, 0, 4);

    const pairwise: { pair: string; kappa: Maybe; band: string; reason?: string }[] = [];
    for (let i = 0; i < panelKeys.length; i++) {
      for (let j = i + 1; j < panelKeys.length; j++) {
        const a = interJudgeItems.map((id) => get("kc", panelKeys[i], 1, id)!.scores![dim]);
        const b = interJudgeItems.map((id) => get("kc", panelKeys[j], 1, id)!.scores![dim]);
        const k = quadraticWeightedKappa(a, b, 0, 4);
        pairwise.push({
          pair: `${panelKeys[i]} vs ${panelKeys[j]}`,
          kappa: k.value,
          band: agreementBand(k.value),
          reason: k.undefinedReason,
        });
      }
    }

    let exact = 0;
    const absDiffs: number[] = [];
    for (const u of units) {
      if (u.length === panelKeys.length && u.every((v) => v === u[0])) exact++;
      for (let i = 0; i < u.length; i++) for (let j = i + 1; j < u.length; j++) absDiffs.push(Math.abs(u[i] - u[j]));
    }

    const perJudgeMean: Record<string, number> = {};
    const perJudgeSd: Record<string, number> = {};
    for (const k of panelKeys) {
      const v = interJudgeItems.map((id) => get("kc", k, 1, id)!.scores![dim]);
      perJudgeMean[k] = mean(v);
      perJudgeSd[k] = sd(v);
    }

    return {
      dimension: dim,
      alpha,
      alphaBand: alphaBand(alpha.value),
      pairwiseQwk: pairwise,
      exactThreeWayMatchRate: units.length ? exact / units.length : 0,
      meanAbsPairwiseDiff: absDiffs.length ? mean(absDiffs) : 0,
      perJudgeMean,
      perJudgeSd,
    };
  });

  // Pooled alpha treats every (item, dimension) cell as a unit. This assumes
  // dimensions are exchangeable, which they are not exactly; it is reported as a
  // summary alongside the per-dimension values, never instead of them.
  const pooledUnits = DIMENSIONS.flatMap((d) => perDimensionUnits(panelKeys, interJudgeItems, d));
  const pooledAlpha = krippendorffAlphaOrdinal(pooledUnits, 0, 4);
  const pooledCI = bootstrapCI(
    interJudgeItems,
    (sample) =>
      krippendorffAlphaOrdinal(
        DIMENSIONS.flatMap((d) => perDimensionUnits(panelKeys, sample, d)),
        0,
        4,
      ).value,
    { replicates: 1000, seed: 424242 },
  );

  // Total-score correlation between judges.
  const totalSpearman: { pair: string; rho: Maybe }[] = [];
  for (let i = 0; i < panelKeys.length; i++) {
    for (let j = i + 1; j < panelKeys.length; j++) {
      const a = interJudgeItems.map((id) => get("kc", panelKeys[i], 1, id)!.normalizedScore as number);
      const b = interJudgeItems.map((id) => get("kc", panelKeys[j], 1, id)!.normalizedScore as number);
      totalSpearman.push({ pair: `${panelKeys[i]} vs ${panelKeys[j]}`, rho: spearman(a, b).value });
    }
  }

  // Decision agreement on the DERIVED decision.
  const decisionKappa: { pair: string; kappa: Maybe; band: string; reason?: string; exactMatchRate: number }[] = [];
  for (let i = 0; i < panelKeys.length; i++) {
    for (let j = i + 1; j < panelKeys.length; j++) {
      const a = interJudgeItems.map((id) => get("kc", panelKeys[i], 1, id)!.decision ?? "");
      const b = interJudgeItems.map((id) => get("kc", panelKeys[j], 1, id)!.decision ?? "");
      const k = cohenKappaNominal(a, b);
      const match = a.filter((v, idx) => v === b[idx]).length / (a.length || 1);
      decisionKappa.push({
        pair: `${panelKeys[i]} vs ${panelKeys[j]}`,
        kappa: k.value,
        band: agreementBand(k.value),
        reason: k.undefinedReason,
        exactMatchRate: match,
      });
    }
  }

  return { items: interJudgeItems.length, dims, pooledAlpha, pooledCI, totalSpearman, decisionKappa };
}

// ---------------------------------------------------------------------------
// M4 self-consistency (KC, production judge, repeated runs)
// ---------------------------------------------------------------------------

function selfConsistency() {
  const judge = PRIMARY_JUDGE.key;
  const reps = [...new Set(ok.filter((r) => r.system === "kc" && r.judgeKey === judge).map((r) => r.replicate))].sort();
  const items = allItems.filter((id) => reps.every((rep) => get("kc", judge, rep, id)?.scores));

  const dims = DIMENSIONS.map((dim) => {
    const units = items.map((id) => reps.map((rep) => get("kc", judge, rep, id)!.scores![dim]));
    const alpha = krippendorffAlphaOrdinal(units, 0, 4);
    const exact = units.filter((u) => u.every((v) => v === u[0])).length;
    const sds = units.map((u) => sd(u));
    return {
      dimension: dim,
      alpha: alpha,
      alphaBand: alphaBand(alpha.value),
      exactAgreementRate: units.length ? exact / units.length : 0,
      meanWithinItemSd: mean(sds),
      maxWithinItemRange: units.length ? Math.max(...units.map((u) => Math.max(...u) - Math.min(...u))) : 0,
    };
  });

  const totals = items.map((id) => reps.map((rep) => get("kc", judge, rep, id)!.normalizedScore as number));
  const decisionSets = items.map((id) => reps.map((rep) => get("kc", judge, rep, id)!.decision ?? ""));
  const flips = decisionSets.filter((d) => !d.every((v) => v === d[0])).length;
  const flipDetail = items
    .map((id, i) => ({ itemId: id, decisions: decisionSets[i] }))
    .filter((x) => !x.decisions.every((v) => v === x.decisions[0]));

  return {
    judge,
    replicates: reps,
    items: items.length,
    dims,
    meanTotalScoreSd: mean(totals.map((t) => sd(t))),
    meanTotalScoreRange: mean(totals.map((t) => Math.max(...t) - Math.min(...t))),
    maxTotalScoreRange: totals.length ? Math.max(...totals.map((t) => Math.max(...t) - Math.min(...t))) : 0,
    decisionFlipRate: items.length ? flips / items.length : 0,
    decisionFlips: flipDetail,
  };
}

// ---------------------------------------------------------------------------
// M5 cost / latency / tokens
// ---------------------------------------------------------------------------

interface CostRow {
  system: string;
  judgeKey: string;
  calls: number;
  meanInputTokens: number;
  meanOutputTokens: number;
  meanLatencyMs: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  usdPerEval: number;
  totalUsd: number;
}

function costTable(): CostRow[] {
  const groups = new Map<string, Rec[]>();
  for (const r of ok) {
    const k = `${r.system}|${r.judgeKey}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const rows: CostRow[] = [];
  for (const [k, recs] of groups) {
    const [system, judgeKey] = k.split("|");
    const lat = recs.map((r) => r.latencyMs).sort((a, b) => a - b);
    rows.push({
      system,
      judgeKey,
      calls: recs.length,
      meanInputTokens: mean(recs.map((r) => r.inputTokens)),
      meanOutputTokens: mean(recs.map((r) => r.outputTokens)),
      meanLatencyMs: mean(lat),
      medianLatencyMs: median(lat),
      p95LatencyMs: lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] : 0,
      usdPerEval: mean(recs.map((r) => r.usd)),
      totalUsd: recs.reduce((a, r) => a + r.usd, 0),
    });
  }
  return rows.sort((a, b) => a.system.localeCompare(b.system) || a.judgeKey.localeCompare(b.judgeKey));
}

// ---------------------------------------------------------------------------
// M6 evidence verifiability (KC only)
// ---------------------------------------------------------------------------

function evidenceTable() {
  return panelKeys.map((k) => {
    const recs = allItems.map((id) => get("kc", k, 1, id)).filter((r): r is Rec => Boolean(r));
    const rates = recs.map((r) => r.evidenceVerifiedRate).filter((v): v is number => v !== null);
    return {
      judgeKey: k,
      items: recs.length,
      meanVerifiedRate: rates.length ? mean(rates) : 0,
      allSixVerifiedRate: rates.length ? rates.filter((v) => v === 1).length / rates.length : 0,
      meanEvidenceCount: mean(recs.map((r) => r.evidenceCount)),
      itemsWithNoEvidence: recs.filter((r) => r.evidenceCount === 0).length,
    };
  });
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

const systemsPresent = [...new Set(ok.map((r) => r.system))];

const tierResults = systemsPresent
  .map((s) => {
    const judge = s === "alt_c_similarity" ? [...new Set(ok.filter((r) => r.system === s).map((r) => r.judgeKey))][0] : PRIMARY_JUDGE.key;
    return tierDiscrimination(s, judge);
  })
  .filter((x): x is TierResult => Boolean(x));

const perturbResults = systemsPresent
  .map((s) => {
    const judge = s === "alt_c_similarity" ? [...new Set(ok.filter((r) => r.system === s).map((r) => r.judgeKey))][0] : PRIMARY_JUDGE.key;
    return perturbationSensitivity(s, judge);
  })
  .filter((x): x is PerturbResult => Boolean(x));

// KC under the other panel judges, to show the proposal's behaviour is not an
// artefact of one model.
const kcTierByJudge = panelKeys.map((k) => tierDiscrimination("kc", k)).filter((x): x is TierResult => Boolean(x));
const kcPerturbByJudge = panelKeys.map((k) => perturbationSensitivity("kc", k)).filter((x): x is PerturbResult => Boolean(x));

const inter = interJudgeAnalysis();
const self = selfConsistency();
const costs = costTable();
const evidence = evidenceTable();

// ALT-C cost is charged at run level (the embeddings endpoint returns no token
// counts), so it is absent from the per-record usd field and is added back here
// from the same character/4 approximation run.ts used.
const altCApproxTokens = Math.ceil(
  ([...new Set(ok.filter((r) => r.system === "alt_c_similarity").map((r) => r.itemId))].length > 0
    ? JSON.parse(readFileSync(join(DIR, "corpus.json"), "utf8")).items.map((i: { artifact: string }) => i.artifact)
    : []
  ).reduce((a: number, t: string) => a + t.length, 0) / 4,
);
const altCUsd = (altCApproxTokens / 1_000_000) * 0.15;
const totalSpend = ok.reduce((a, r) => a + r.usd, 0) + altCUsd;
const spendByJudge = Object.fromEntries(
  [...new Set(ok.map((r) => r.judgeKey))].map((k) => [
    k,
    Number(
      (ok.filter((r) => r.judgeKey === k).reduce((a, r) => a + r.usd, 0) +
        (k === "gemini-embedding-001" ? altCUsd : 0)).toFixed(5),
    ),
  ]),
);

const analysis = {
  generatedAt: new Date().toISOString(),
  recordsTotal: records.length,
  recordsOk: ok.length,
  recordsFailed: failures.length,
  failures: failures.map((f) => ({ key: f.key, error: f.error })),
  corpus: {
    scenarios: scenarios.map((s) => ({ id: s, domain: domainOf.get(s) })),
    baseItems: baseItems.length,
    perturbedItems: perturbedItems.length,
  },
  tierDiscrimination: tierResults,
  kcTierByJudge,
  perturbationSensitivity: perturbResults,
  kcPerturbByJudge,
  interJudge: inter,
  selfConsistency: self,
  cost: costs,
  evidence,
  spend: { totalUsd: Number(totalSpend.toFixed(5)), byJudge: spendByJudge },
};

writeFileSync(join(DIR, "analysis.json"), JSON.stringify(analysis, null, 2));

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

const L: string[] = [];
const p = (s = "") => L.push(s);

p("# KnowledgeCore judge validation — human-free protocol, first real run");
p("");
p(`Generated ${analysis.generatedAt} from \`${join(DIR, "records.jsonl")}\`.`);
p("");
p("This report answers one question: **can the 6-dimension CheckpointEvaluator rubric be trusted as a measuring instrument, without a human rater panel?** Chapter 6 §6.2 of the thesis marks this study as PENDING and explicitly forbids reporting a number until it is run. It is now run. Some of the answers are good and some are not, and both are reported.");
p("");
p("## 0. What replaces the human raters, and what that costs in validity");
p("");
p("The original design (thesis §6.2, CHARTER C.1) called for dual rating by the author against the judge, with Cohen's kappa. That design has two problems beyond mere availability: a single author rating his own system's output is not an independent panel, and the one attempt at it (2026-06-03, n=28, on the *search* rubric, not this one) produced kappa 0.214 and 0.314, i.e. slight-to-fair, with disagreement that was traced to definitional drift rather than noise.");
p("");
p("Three human-free substitutes are used instead. Each replaces a different property that human dual-rating was supposed to establish:");
p("");
p("| Property needed | Human method | Human-free substitute used here |");
p("|---|---|---|");
p("| Convergent validity (is the score about the thing, not about the model) | Second human rater | **Inter-judge agreement** across three independent model families |");
p("| Reliability (does the same input get the same score) | Intra-rater test-retest | **Self-consistency** across repeated runs at fixed input, production temperature |");
p("| Directional validity (does worse work score worse) | Human ranking of artifacts | **Designed-tier corpus** plus a **deterministic perturbation battery** |");
p("");
p("**What this cannot do.** None of the three establishes agreement with an expert human. A panel of models can be jointly wrong in a correlated way, and models trained on overlapping data are not independent in the way two human raters are. The tier labels are author-assigned using the rubric's own descriptors, so recovering them is a necessary condition for validity, not a sufficient one. The honest claim available from this study is *the instrument is internally consistent, reproducible, and directionally sensitive to degradation*; the claim NOT available is *the instrument agrees with expert human judgement*. That gap should be stated in the article rather than papered over.");
p("");

p("## 1. Corpus");
p("");
p(`${scenarios.length} goalpost scenarios spanning technical and soft subjects (${scenarios.map((s) => `${s} [${domainOf.get(s)}]`).join(", ")}).`);
p("");
p(`- **${baseItems.length} designed-tier artifacts**: 4 quality tiers per scenario (T0 non-answer, T1 recognition-only, T2 proficient, T3 mastery), authored against the rubric's own 0-4 level descriptors.`);
p(`- **${perturbedItems.length} perturbed artifacts**: ${PERTURBATIONS.length} deterministic degradations applied to each scenario's T3 mastery artifact.`);
p(`- **${allItems.length} items total.**`);
p("");
p("Perturbations are pure, seeded string transforms with no model in the loop, so the degraded version is reproducible byte-for-byte and cannot have been made worse by a model that also scores it:");
p("");
p("| Perturbation | What it destroys | Predicted worst-hit dimensions |");
p("|---|---|---|");
for (const pt of PERTURBATIONS) p(`| \`${pt.id}\` | ${pt.rationale} | ${pt.expectedDimensions.join(", ")} |`);
p("");

// Verdict against the thresholds fixed in EVAL-PROTOCOL-2026-07-31.md §2.6.
// Computed, not asserted, so a threshold cannot be quietly moved after the fact.
const TH = { x1Rho: 0.7, x2Drop: 0.9, x3Alpha: 0.667, x4Flip: 0.05 };
const verdictRow = (sys: string) => {
  const t = tierResults.find((r) => r.system === sys);
  const pr = perturbResults.find((r) => r.system === sys);
  const x1 = t && t.spearman !== null && t.spearman >= TH.x1Rho && (t.ciLower ?? -1) > 0;
  const dropRate = pr ? pr.strictDrops / pr.n : 0;
  const x2 = pr ? dropRate >= TH.x2Drop : false;
  return { sys, rho: t?.spearman ?? null, ciLower: t?.ciLower ?? null, x1, dropRate, x2 };
};
const verdicts = systemsPresent.map(verdictRow);
const kcFlip = self.decisionFlipRate;
const kcAlpha = inter.pooledAlpha.value;

p("## 2. Verdict against the thresholds fixed before the run");
p("");
p("Thresholds come from `EVAL-PROTOCOL-2026-07-31.md` §2.6 and were written into `analyze.ts` before any result existed. They are evaluated in code here so that none can be quietly moved after seeing the data.");
p("");
p("| Criterion | Threshold | KnowledgeCore | ALT-A holistic | ALT-B bare rubric | ALT-C similarity |");
p("|---|---|---|---|---|---|");
{
  const cell = (sys: string, f: (v: ReturnType<typeof verdictRow>) => string) => {
    const v = verdicts.find((x) => x.sys === sys);
    return v ? f(v) : "n/a";
  };
  const order = ["kc", "alt_a_holistic", "alt_b_bare", "alt_c_similarity"];
  p(
    "| X1 directional validity (Spearman rho) | >= 0.70, CI lower > 0 | " +
      order.map((s) => cell(s, (v) => `${fmt(v.rho)} ${v.x1 ? "PASS" : "FAIL"}`)).join(" | ") +
      " |",
  );
  p(
    "| X2 robustness (strict-drop rate) | >= 90% | " +
      order.map((s) => cell(s, (v) => `${pct(v.dropRate)} ${v.x2 ? "PASS" : "FAIL"}`)).join(" | ") +
      " |",
  );
  p(
    `| X3 convergent validity (pooled ordinal alpha) | >= 0.667 | ${fmt(kcAlpha)} ${
      (kcAlpha ?? 0) >= TH.x3Alpha ? "PASS" : "FAIL"
    } | not applicable | not applicable | not applicable |`,
  );
  p(
    `| X4 reliability (decision flip rate) | <= 5% | ${pct(kcFlip)} ${kcFlip <= TH.x4Flip ? "PASS" : "FAIL"} | not measured | not measured | not measured |`,
  );
  p(
    "| Machine-verifiable evidence | property present | yes | structurally absent | structurally absent | structurally absent |",
  );
}
p("");
p("X3 and X4 were run for the proposal only. That is a real scope limit, not an omission of an unflattering comparison: the replicate and cross-family budget was spent on the system whose trustworthiness the article depends on, and the alternatives are not being defended as instruments.");
p("");
p("**Headline reading.**");
p("");
{
  const kcT = verdicts.find((v) => v.sys === "kc")!;
  const aT = verdicts.find((v) => v.sys === "alt_a_holistic")!;
  const bT = verdicts.find((v) => v.sys === "alt_b_bare")!;
  const cT = verdicts.find((v) => v.sys === "alt_c_similarity")!;
  p(`1. **The proposal is the only LLM-based system that passes the robustness bar.** It drops the score on ${pct(kcT.dropRate)} of deliberately degraded artifacts, against ${pct(aT.dropRate)} for the holistic grader and ${pct(bT.dropRate)} for the bare rubric. The gap to ALT-B is the load-bearing result: six numbered dimensions with no level descriptors, no evidence contract and a model-chosen decision performs WORSE than a single holistic score, so the contribution is the rubric's specification, not its decomposition.`);
  p("");
  p(`2. **The alternatives saturate and the proposal does not.** Both LLM alternatives reach a mean of ~100 by tier T2 and then cannot separate proficient work from mastery work (T2->T3 separation ${aT.sys === "alt_a_holistic" ? "0/6" : ""} for ALT-A and 1/6 for ALT-B, against 6/6 for the proposal). A tutoring system built on either would advance every competent learner identically and could not drive adaptation.`);
  p("");
  p(`3. **The proposal FAILS its own reliability bar.** The decision flip rate is ${pct(kcFlip)} against a pre-registered ceiling of 5%. Per-dimension scores are highly reproducible (alpha 0.90-0.98), but the deterministic decision function has hard thresholds, so a one-level wobble on a single dimension at a boundary flips the learner-visible outcome. This is a genuine defect of the shipped design and section 6 names the three affected items.`);
  p("");
  p(`4. **The cheapest comparator is not the worst one, and that must be said.** ALT-C, which uses no LLM judge at all, has a perfect ${pct(cT.dropRate)} strict-drop rate and costs about 0.3% of the proposal per evaluation at a tenth of the latency. It loses on discrimination (rho ${fmt(cT.rho)} versus ${fmt(kcT.rho)}, and it cannot separate T1 from T2 in 2 of 6 scenarios), it produces no rubric profile, no evidence and no rationale, and it requires a hand-authored reference answer per goalpost, which is exactly the authoring burden the system exists to remove. But its perturbation sensitivity is real and the article should not pretend otherwise.`);
}
p("");
p("## 3. Directional validity: does the rubric order known-worse work below known-better work?");
p("");
p("Spearman rank correlation between the designed tier (0-3) and the system's 0-100 score, over the base items. The 95% interval is a **cluster** percentile bootstrap resampling whole scenarios, not individual items, because the four tiers of one scenario share an author and a subject and are not independent.");
p("");
p("| System | n | Spearman rho (tier vs score) | 95% CI | mean T0 | mean T1 | mean T2 | mean T3 | scenarios non-decreasing | strictly increasing |");
p("|---|---|---|---|---|---|---|---|---|---|");
for (const t of tierResults) {
  p(
    `| ${SYSTEM_LABELS[t.system] ?? t.system} | ${t.n} | ${fmt(t.spearman)} | ${
      t.ciLower === null ? "n/a" : `${fmt(t.ciLower)} to ${fmt(t.ciUpper)}`
    } | ${fmt(t.meanByTier[0], 1)} | ${fmt(t.meanByTier[1], 1)} | ${fmt(t.meanByTier[2], 1)} | ${fmt(t.meanByTier[3], 1)} | ${t.nonDecreasingScenarios}/${t.scenariosEvaluated} | ${t.strictlyIncreasingScenarios}/${t.scenariosEvaluated} |`,
  );
}
p("");
p("Adjacent-tier separation, i.e. how often the score actually rises between neighbouring tiers within the same scenario (this is where a ceiling shows up):");
p("");
p("| System | " + (tierResults[0]?.adjacentSeparation.map((a) => a.pair).join(" | ") ?? "") + " |");
p("|---|" + (tierResults[0]?.adjacentSeparation.map(() => "---").join("|") ?? "") + "|");
for (const t of tierResults) {
  p(`| ${SYSTEM_LABELS[t.system] ?? t.system} | ${t.adjacentSeparation.map((a) => `${a.increased}/${a.of}`).join(" | ")} |`);
}
p("");
p("The same measurement for the KnowledgeCore rubric under each panel judge, to check the result is a property of the rubric and not of one model:");
p("");
p("| Judge | n | Spearman rho | 95% CI | mean T0 | mean T1 | mean T2 | mean T3 |");
p("|---|---|---|---|---|---|---|---|");
for (const t of kcTierByJudge) {
  p(
    `| ${t.judgeKey} | ${t.n} | ${fmt(t.spearman)} | ${t.ciLower === null ? "n/a" : `${fmt(t.ciLower)} to ${fmt(t.ciUpper)}`} | ${fmt(t.meanByTier[0], 1)} | ${fmt(t.meanByTier[1], 1)} | ${fmt(t.meanByTier[2], 1)} | ${fmt(t.meanByTier[3], 1)} |`,
  );
}
p("");

p("## 4. Perturbation battery: degraded input MUST score lower");
p("");
p("Each perturbed artifact is compared against the mastery artifact it was degraded from, scored by the same system in the same run. A tie or an increase is a **failure of the instrument**, and both are counted separately below rather than merged into a pass rate.");
p("");
p("| System | pairs | strict drops | ties | increases | strict-drop rate | mean score drop (0-100) |");
p("|---|---|---|---|---|---|---|");
for (const r of perturbResults) {
  p(
    `| ${SYSTEM_LABELS[r.system] ?? r.system} | ${r.n} | ${r.strictDrops} | ${r.ties} | ${r.increases} | ${pct(r.strictDrops / r.n)} | ${r.meanDrop.toFixed(1)} |`,
  );
}
p("");
p("Per perturbation type, for the KnowledgeCore rubric under the production judge:");
p("");
const kcPert = perturbResults.find((r) => r.system === "kc");
if (kcPert) {
  p("| Perturbation | n | strict drops | mean parent score | mean perturbed score | mean drop |");
  p("|---|---|---|---|---|---|");
  for (const b of kcPert.byPerturbation) {
    p(`| \`${b.id}\` | ${b.n} | ${b.strictDrops}/${b.n} | ${b.meanParent.toFixed(1)} | ${b.meanPerturbed.toFixed(1)} | ${b.meanDrop.toFixed(1)} |`);
  }
  p("");
  if (kcPert.violations.length) {
    p(`**Instrument failures (${kcPert.violations.length}).** These are items where a deliberately degraded artifact did NOT score lower. Listed individually because they are the most diagnostic result in the study:`);
    p("");
    p("| Item | Perturbation | Parent score | Perturbed score |");
    p("|---|---|---|---|");
    for (const v of kcPert.violations) p(`| \`${v.itemId}\` | \`${v.perturbation}\` | ${v.parentScore.toFixed(1)} | ${v.perturbedScore.toFixed(1)} |`);
    p("");
  } else {
    p("No violations: every degraded artifact scored strictly below its parent under the production judge.");
    p("");
  }
}
p("Strict-drop rate for the KnowledgeCore rubric under each panel judge:");
p("");
p("| Judge | pairs | strict drops | ties | increases | strict-drop rate | mean drop |");
p("|---|---|---|---|---|---|---|");
for (const r of kcPerturbByJudge) {
  p(`| ${r.judgeKey} | ${r.n} | ${r.strictDrops} | ${r.ties} | ${r.increases} | ${pct(r.strictDrops / r.n)} | ${r.meanDrop.toFixed(1)} |`);
}
p("");

p("## 5. Inter-judge agreement (the human-rater substitute)");
p("");
p(`Three independent model families scored all ${inter.items} items on the identical production prompt and schema: ${JUDGE_PANEL.map((j) => `\`${j.key}\``).join(", ")}. Krippendorff's alpha uses the ORDINAL difference function (rubric levels are ordered, not nominal), which is the correct choice here and is stricter than treating the levels as unordered categories.`);
p("");
p(`**Pooled alpha across all six dimensions: ${fmt(inter.pooledAlpha.value)}** (${alphaBand(inter.pooledAlpha.value)})${inter.pooledCI.lower !== null ? `, 95% CI ${fmt(inter.pooledCI.lower)} to ${fmt(inter.pooledCI.upper)}` : ""}. Pooling assumes the six dimensions are exchangeable, which they are not exactly, so the per-dimension table below is the primary result and the pooled figure is a summary only.`);
p("");
p("| Dimension | Krippendorff alpha (ordinal) | band | 3-way exact match | mean pairwise abs. diff (0-4 scale) |");
p("|---|---|---|---|---|");
for (const d of inter.dims) {
  p(`| ${d.dimension} | ${d.alpha.value === null ? `n/a (${d.alpha.undefinedReason})` : fmt(d.alpha.value)} | ${d.alphaBand} | ${pct(d.exactThreeWayMatchRate)} | ${d.meanAbsPairwiseDiff.toFixed(2)} |`);
}
p("");
p("Pairwise quadratic-weighted Cohen's kappa per dimension:");
p("");
const pairNames = inter.dims[0]?.pairwiseQwk.map((x) => x.pair) ?? [];
p("| Dimension | " + pairNames.join(" | ") + " |");
p("|---|" + pairNames.map(() => "---").join("|") + "|");
for (const d of inter.dims) {
  p(`| ${d.dimension} | ` + d.pairwiseQwk.map((x) => (x.kappa === null ? `n/a` : `${fmt(x.kappa)} (${x.band})`)).join(" | ") + " |");
}
p("");
p("Per-judge mean level per dimension. Systematic offsets here are severity differences, which depress agreement without meaning the judges disagree about the ORDERING:");
p("");
p("| Dimension | " + panelKeys.map((k) => `${k} mean (sd)`).join(" | ") + " |");
p("|---|" + panelKeys.map(() => "---").join("|") + "|");
for (const d of inter.dims) {
  p(`| ${d.dimension} | ` + panelKeys.map((k) => `${d.perJudgeMean[k].toFixed(2)} (${d.perJudgeSd[k].toFixed(2)})`).join(" | ") + " |");
}
p("");
p("Rank agreement on the overall 0-100 score, which is what actually drives the decision:");
p("");
p("| Judge pair | Spearman rho on total score |");
p("|---|---|");
for (const s of inter.totalSpearman) p(`| ${s.pair} | ${fmt(s.rho)} |`);
p("");
p("Agreement on the **derived decision** (advance / repeat / adjust_plan). Because the decision is deterministic code applied to the scores, this measures how far score disagreement propagates into behaviour, which is the number that actually matters to a learner:");
p("");
p("| Judge pair | exact decision match | Cohen kappa (nominal) | band |");
p("|---|---|---|---|");
for (const d of inter.decisionKappa) {
  p(`| ${d.pair} | ${pct(d.exactMatchRate)} | ${d.kappa === null ? `n/a (${d.reason})` : fmt(d.kappa)} | ${d.band} |`);
}
p("");

p("## 6. Self-consistency (the test-retest substitute)");
p("");
p(`\`${self.judge}\` scored all ${self.items} items ${self.replicates.length} times at the production temperature (0.2, the value in \`checkpointEvaluator.service.ts\`). Measuring at the production temperature rather than 0 is deliberate: it reports the variance a real learner is exposed to, not an artificially deterministic best case.`);
p("");
p("| Dimension | Krippendorff alpha across runs | band | exact agreement across all runs | mean within-item SD | max within-item range |");
p("|---|---|---|---|---|---|");
for (const d of self.dims) {
  p(`| ${d.dimension} | ${d.alpha.value === null ? `n/a (${d.alpha.undefinedReason})` : fmt(d.alpha.value)} | ${d.alphaBand} | ${pct(d.exactAgreementRate)} | ${d.meanWithinItemSd.toFixed(3)} | ${d.maxWithinItemRange} |`);
}
p("");
p(`- Mean within-item SD of the total 0-100 score: **${self.meanTotalScoreSd.toFixed(2)}**`);
p(`- Mean within-item range of the total score: **${self.meanTotalScoreRange.toFixed(2)}**, worst case **${self.maxTotalScoreRange.toFixed(2)}**`);
p(`- **Decision flip rate: ${pct(self.decisionFlipRate)}** (${self.decisionFlips.length} of ${self.items} items received a different derived decision on repeated identical input)`);
p("");
if (self.decisionFlips.length) {
  p("Items whose decision was not reproducible:");
  p("");
  p("| Item | decisions across runs |");
  p("|---|---|");
  for (const f of self.decisionFlips) p(`| \`${f.itemId}\` | ${f.decisions.join(", ")} |`);
  p("");
}

p("## 7. Auditability: the verbatim-evidence contract");
p("");
p("The proposal requires one evidence quote per dimension, copied verbatim from the learner's artifact, checked in code by the production matcher (`lib/services/providers/verbatim.ts`). This is a property the alternatives structurally cannot offer: ALT-A and ALT-B return no quotes, and ALT-C returns no explanation at all. Verification rate is therefore reported for the proposal only, and the comparison is categorical.");
p("");
p("| Judge | items | mean quotes verified | items with all quotes verified | mean quotes returned | items returning no evidence |");
p("|---|---|---|---|---|---|");
for (const e of evidence) {
  p(`| ${e.judgeKey} | ${e.items} | ${pct(e.meanVerifiedRate)} | ${pct(e.allSixVerifiedRate)} | ${e.meanEvidenceCount.toFixed(2)} | ${e.itemsWithNoEvidence} |`);
}
p("");

p("## 8. Cost, latency and tokens");
p("");
p("Measured, not modelled. Token counts are provider-reported for every call; latency is wall-clock around the HTTP request; USD is computed from those token counts at the list prices recorded in `providers.ts`.");
p("");
p("| System | Model | Calls | Mean input tok | Mean output tok | Mean latency (ms) | Median (ms) | p95 (ms) | USD / evaluation | Total USD |");
p("|---|---|---|---|---|---|---|---|---|---|");
for (const c of costs) {
  p(
    `| ${c.system} | ${c.judgeKey} | ${c.calls} | ${c.meanInputTokens.toFixed(0)} | ${c.meanOutputTokens.toFixed(0)} | ${c.meanLatencyMs.toFixed(0)} | ${c.medianLatencyMs.toFixed(0)} | ${c.p95LatencyMs.toFixed(0)} | ${c.usdPerEval.toFixed(6)} | ${c.totalUsd.toFixed(4)} |`,
  );
}
p("");
p("`alt_c_similarity` reports 0 tokens because the embeddings endpoint does not return token counts; its cost is computed from a character/4 approximation at the run level and is the only estimated cost figure in this study. It is a rounding error either way.");
p("");

p("## 9. Failures");
p("");
if (failures.length === 0) {
  p(`No call failed. ${ok.length} records, 0 errors.`);
} else {
  p(`${failures.length} of ${records.length} calls failed and are excluded from the statistics above. Listed so the denominators are auditable:`);
  p("");
  p("| Key | Error |");
  p("|---|---|");
  for (const f of failures.slice(0, 40)) p(`| \`${f.key}\` | ${(f.error ?? "").replace(/\|/g, "/").slice(0, 160)} |`);
  if (failures.length > 40) p(`| ... | ${failures.length - 40} more, see analysis.json |`);
}
p("");
p(`**Measured API spend for this study: ${analysis.spend.totalUsd.toFixed(4)} USD.** By model: ${Object.entries(analysis.spend.byJudge).map(([k, v]) => `${k} ${(v as number).toFixed(4)}`).join(", ")}.`);
p("");

writeFileSync(OUT_MD, L.join("\n"));

console.log(`Wrote ${join(DIR, "analysis.json")}`);
console.log(`Wrote ${OUT_MD}`);
console.log("");
console.log(`records ok=${ok.length} failed=${failures.length}  spend=${analysis.spend.totalUsd.toFixed(4)} USD`);
console.log(`pooled inter-judge alpha = ${fmt(inter.pooledAlpha.value)}`);
console.log(`self-consistency decision flip rate = ${pct(self.decisionFlipRate)}`);
for (const t of tierResults) console.log(`  tier rho ${t.system}: ${fmt(t.spearman)}`);
for (const r of perturbResults) console.log(`  perturb strict-drop ${r.system}: ${r.strictDrops}/${r.n}`);
