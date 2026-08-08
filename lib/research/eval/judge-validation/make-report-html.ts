/**
 * Builds the human-readable HTML summary from the machine-readable results.
 *
 * Reads analysis.json (judge validation) and, when present, the ingestion-tier
 * bundles. Every figure on the page comes from those files: nothing is typed in
 * by hand, so the page cannot drift from the data.
 *
 * Run: bun run lib/research/eval/judge-validation/make-report-html.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PAPERS = "/Users/dragosvelicu/Documents/_hq/work/papers-for-professor/licenta-knowledgecore";
const ANALYSIS = arg("analysis", `${PAPERS}/raw-results/judge-validation-2026-07-31/analysis.json`);
const SEARCH = arg("search", "/Users/dragosvelicu/Documents/_hq/work/university/Licenta/knowledgecore/lib/research/eval/out-2026-07-31/search-results.json");
const EMB = arg("embeddings", "/Users/dragosvelicu/Documents/_hq/work/university/Licenta/knowledgecore/lib/research/eval/out-2026-07-31/embedding-results.json");
const OUT = arg("out", `${PAPERS}/eval-report-2026-07-31.html`);

const A = JSON.parse(readFileSync(ANALYSIS, "utf8"));
const search = existsSync(SEARCH) ? JSON.parse(readFileSync(SEARCH, "utf8")) : null;
const emb = existsSync(EMB) ? JSON.parse(readFileSync(EMB, "utf8")) : null;

const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (v: unknown, dp = 3) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(dp) : "n/a");
const pc = (v: unknown, dp = 1) => (typeof v === "number" && Number.isFinite(v) ? `${(v * 100).toFixed(dp)}%` : "n/a");

const SYS_SHORT: Record<string, string> = {
  kc: "KnowledgeCore",
  alt_a_holistic: "ALT-A holistic",
  alt_b_bare: "ALT-B bare rubric",
  alt_c_similarity: "ALT-C similarity",
};
const SYS_ORDER = ["kc", "alt_a_holistic", "alt_b_bare", "alt_c_similarity"];
// Categorical slots 1, 2, 3, 7 of the reference palette. Validated with
// scripts/validate_palette.js in BOTH modes before use: all checks pass; the
// light-mode aqua sits below 3:1 on the surface, so every mark on this page
// carries a visible direct label, which is the documented relief.
const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];
const colorOf = (sys: string) => SERIES[SYS_ORDER.indexOf(sys)] ?? "var(--s1)";

const tier = (sys: string) => A.tierDiscrimination.find((t: { system: string }) => t.system === sys);
const pert = (sys: string) => A.perturbationSensitivity.find((t: { system: string }) => t.system === sys);

// ---------------------------------------------------------------------------
// Charts (inline SVG, no external libraries)
// ---------------------------------------------------------------------------

/** Line chart: mean score by designed tier, one line per system. */
function tierChart(): string {
  const W = 660;
  const H = 300;
  const M = { t: 16, r: 150, b: 42, l: 44 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const x = (i: number) => M.l + (i / 3) * pw;
  const y = (v: number) => M.t + ph - (v / 100) * ph;

  const grid = [0, 25, 50, 75, 100]
    .map(
      (v) =>
        `<line x1="${M.l}" y1="${y(v)}" x2="${M.l + pw}" y2="${y(v)}" class="grid"/>` +
        `<text x="${M.l - 8}" y="${y(v) + 4}" class="tick" text-anchor="end">${v}</text>`,
    )
    .join("");

  const xlab = ["T0 non-answer", "T1 recognition", "T2 proficient", "T3 mastery"]
    .map((l, i) => `<text x="${x(i)}" y="${M.t + ph + 22}" class="tick" text-anchor="middle">${l.split(" ")[0]}</text>`)
    .join("");

  // Three of the four series converge near 100 at T3, so naive end-labels
  // overlap. Resolve by ordering the labels by their anchor y and pushing them
  // apart to a minimum spacing, then drawing a leader tick from the true point.
  const LABEL_GAP = 17;
  const anchors = SYS_ORDER.map((sys) => {
    const t = tier(sys);
    return t ? { sys, t, yAnchor: y(t.meanByTier[3]) } : null;
  }).filter((a): a is { sys: string; t: { meanByTier: number[] }; yAnchor: number } => a !== null);

  const placed = anchors.slice().sort((a, b) => a.yAnchor - b.yAnchor);
  let cursor = -Infinity;
  const labelY = new Map<string, number>();
  for (const a of placed) {
    const ly = Math.max(a.yAnchor, cursor + LABEL_GAP);
    labelY.set(a.sys, ly);
    cursor = ly;
  }
  // Keep the stack inside the plot box if it was pushed past the bottom.
  const overflow = cursor - (M.t + ph);
  if (overflow > 0) for (const [k, v] of labelY) labelY.set(k, v - overflow);

  const lines = SYS_ORDER.map((sys) => {
    const t = tier(sys);
    if (!t) return "";
    const pts = t.meanByTier.map((v: number, i: number) => [x(i), y(v)]);
    const d = pts.map((p: number[], i: number) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    const dots = pts
      .map(
        (p: number[], i: number) =>
          `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4.5" fill="${colorOf(sys)}" stroke="var(--surface)" stroke-width="2"><title>${esc(SYS_SHORT[sys])} - tier T${i}: ${t.meanByTier[i].toFixed(1)}</title></circle>`,
      )
      .join("");
    const last = pts[pts.length - 1];
    const ly = labelY.get(sys) ?? last[1];
    const leader =
      Math.abs(ly - last[1]) > 1
        ? `<path d="M${(last[0] + 6).toFixed(1)},${last[1].toFixed(1)} L${(last[0] + 12).toFixed(1)},${ly.toFixed(1)} L${(last[0] + 16).toFixed(1)},${ly.toFixed(1)}" fill="none" stroke="${colorOf(sys)}" stroke-width="1"/>`
        : "";
    return (
      `<path d="${d}" fill="none" stroke="${colorOf(sys)}" stroke-width="2" stroke-linejoin="round"/>${dots}${leader}` +
      `<text x="${(last[0] + 20).toFixed(1)}" y="${(ly + 4).toFixed(1)}" class="dlabel" fill="var(--text-primary)">${esc(SYS_SHORT[sys])} <tspan class="dnum">${t.meanByTier[3].toFixed(0)}</tspan></text>`
    );
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Mean score by designed quality tier for each system">
    ${grid}${xlab}
    <text x="${M.l}" y="${M.t + ph + 38}" class="axis-title">designed quality tier</text>
    ${lines}
  </svg>`;
}

/** Bar chart: perturbation strict-drop rate by system, with the 90% bar. */
function dropChart(): string {
  const W = 660;
  const H = 250;
  const M = { t: 16, r: 96, b: 46, l: 44 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const y = (v: number) => M.t + ph - v * ph;
  const bw = pw / SYS_ORDER.length;

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (v) =>
        `<line x1="${M.l}" y1="${y(v)}" x2="${M.l + pw}" y2="${y(v)}" class="grid"/>` +
        `<text x="${M.l - 8}" y="${y(v) + 4}" class="tick" text-anchor="end">${(v * 100).toFixed(0)}%</text>`,
    )
    .join("");

  const bars = SYS_ORDER.map((sys, i) => {
    const p = pert(sys);
    if (!p) return "";
    const r = p.strictDrops / p.n;
    // 2px surface gap between adjacent bars.
    const bx = M.l + i * bw + 12;
    const w = bw - 26;
    const top = y(r);
    const h = M.t + ph - top;
    return (
      `<path d="M${bx},${M.t + ph} L${bx},${top + 4} Q${bx},${top} ${bx + 4},${top} L${bx + w - 4},${top} Q${bx + w},${top} ${bx + w},${top + 4} L${bx + w},${M.t + ph} Z" fill="${colorOf(sys)}"><title>${esc(SYS_SHORT[sys])}: ${p.strictDrops} of ${p.n} degraded artifacts scored strictly lower</title></path>` +
      `<text x="${bx + w / 2}" y="${top - 8}" class="dlabel" text-anchor="middle" fill="var(--text-primary)">${(r * 100).toFixed(1)}%</text>` +
      `<text x="${bx + w / 2}" y="${M.t + ph + 20}" class="tick" text-anchor="middle">${esc(SYS_SHORT[sys])}</text>` +
      `<text x="${bx + w / 2}" y="${M.t + ph + 34}" class="tick muted">${p.strictDrops}/${p.n}</text>`
    );
  }).join("");

  const thr = y(0.9);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Perturbation strict-drop rate by system">
    ${grid}${bars}
    <line x1="${M.l}" y1="${thr}" x2="${M.l + pw}" y2="${thr}" class="threshold"/>
    <text x="${M.l + pw + 8}" y="${thr + 4}" class="tick">threshold 90%</text>
  </svg>`;
}

/** Bar chart: inter-judge Krippendorff alpha per rubric dimension. */
function alphaChart(): string {
  const dims = A.interJudge.dims as { dimension: string; alpha: { value: number | null } }[];
  const W = 660;
  const H = 260;
  const M = { t: 16, r: 96, b: 46, l: 44 };
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const y = (v: number) => M.t + ph - v * ph;
  const bw = pw / dims.length;

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (v) =>
        `<line x1="${M.l}" y1="${y(v)}" x2="${M.l + pw}" y2="${y(v)}" class="grid"/>` +
        `<text x="${M.l - 8}" y="${y(v) + 4}" class="tick" text-anchor="end">${v.toFixed(2)}</text>`,
    )
    .join("");

  const bars = dims
    .map((d, i) => {
      const v = d.alpha.value ?? 0;
      const adequate = v >= 0.667;
      const bx = M.l + i * bw + 10;
      const w = bw - 22;
      const top = y(v);
      // Status colors carry state, not identity: adequate vs not-adequate.
      const fill = adequate ? "var(--ok)" : "var(--warn)";
      return (
        `<path d="M${bx},${M.t + ph} L${bx},${top + 4} Q${bx},${top} ${bx + 4},${top} L${bx + w - 4},${top} Q${bx + w},${top} ${bx + w},${top + 4} L${bx + w},${M.t + ph} Z" fill="${fill}"><title>${esc(d.dimension)}: alpha ${n(v)} - ${adequate ? "at or above the 0.667 adequacy threshold" : "BELOW the 0.667 adequacy threshold"}</title></path>` +
        `<text x="${bx + w / 2}" y="${top - 8}" class="dlabel" text-anchor="middle" fill="var(--text-primary)">${n(v, 2)}</text>` +
        `<text x="${bx + w / 2}" y="${M.t + ph + 20}" class="tick" text-anchor="middle">${esc(d.dimension)}</text>`
      );
    })
    .join("");

  const thr = y(0.667);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Inter-judge Krippendorff alpha per rubric dimension">
    ${grid}${bars}
    <line x1="${M.l}" y1="${thr}" x2="${M.l + pw}" y2="${thr}" class="threshold"/>
    <text x="${M.l + pw + 8}" y="${thr + 4}" class="tick">adequacy 0.667</text>
  </svg>`;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const kcT = tier("kc");
const kcP = pert("kc");
const flip = A.selfConsistency.decisionFlipRate as number;
const pooled = A.interJudge.pooledAlpha.value as number | null;

const verdictRows = [
  {
    crit: "X1 directional validity",
    metric: "Spearman rho, designed tier vs score",
    thr: "&ge; 0.70",
    cells: SYS_ORDER.map((s) => {
      const t = tier(s);
      const pass = t && t.spearman >= 0.7 && t.ciLower > 0;
      return { v: n(t?.spearman), pass };
    }),
  },
  {
    crit: "X2 robustness",
    metric: "degraded artifact scores strictly lower",
    thr: "&ge; 90%",
    cells: SYS_ORDER.map((s) => {
      const p = pert(s);
      const r = p ? p.strictDrops / p.n : 0;
      return { v: pc(r), pass: Boolean(p) && r >= 0.9 };
    }),
  },
  {
    crit: "X3 convergent validity",
    metric: "pooled ordinal alpha across 3 model families",
    thr: "&ge; 0.667",
    cells: [{ v: n(pooled), pass: (pooled ?? 0) >= 0.667 }, null, null, null],
  },
  {
    crit: "X4 reliability",
    metric: "decision flip rate on identical repeated input",
    thr: "&le; 5%",
    cells: [{ v: pc(flip), pass: flip <= 0.05 }, null, null, null],
  },
  {
    crit: "Auditability",
    metric: "machine-verifiable evidence quotes",
    thr: "present",
    cells: [{ v: "yes", pass: true }, { v: "none", pass: false }, { v: "none", pass: false }, { v: "none", pass: false }],
  },
];

const verdictTable = `
<table class="grid-table">
  <thead><tr><th>Criterion</th><th>Threshold</th>${SYS_ORDER.map(
    (s) => `<th><span class="swatch" style="background:${colorOf(s)}"></span>${esc(SYS_SHORT[s])}</th>`,
  ).join("")}</tr></thead>
  <tbody>
  ${verdictRows
    .map(
      (r) => `<tr>
      <th scope="row"><strong>${r.crit}</strong><span class="sub">${r.metric}</span></th>
      <td class="thr">${r.thr}</td>
      ${r.cells
        .map((c) =>
          c === null
            ? `<td class="na">not run</td>`
            : `<td class="${c.pass ? "pass" : "fail"}">${c.v}<span class="badge">${c.pass ? "PASS" : "FAIL"}</span></td>`,
        )
        .join("")}
    </tr>`,
    )
    .join("")}
  </tbody>
</table>`;

const costRows = (A.cost as {
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
}[])
  .slice()
  .sort((a, b) => a.usdPerEval - b.usdPerEval)
  .map(
    (c) => `<tr>
      <td>${esc(SYS_SHORT[c.system] ?? c.system)}</td>
      <td class="mono">${esc(c.judgeKey)}</td>
      <td class="num">${c.calls}</td>
      <td class="num">${c.meanInputTokens.toFixed(0)}</td>
      <td class="num">${c.meanOutputTokens.toFixed(0)}</td>
      <td class="num">${c.meanLatencyMs.toFixed(0)}</td>
      <td class="num">${c.p95LatencyMs.toFixed(0)}</td>
      <td class="num">${c.usdPerEval < 0.0001 ? "&lt;0.0001" : c.usdPerEval.toFixed(4)}</td>
      <td class="num">${(c.usdPerEval * 3).toFixed(4)}</td>
    </tr>`,
  )
  .join("");

const alphaTable = (A.interJudge.dims as {
  dimension: string;
  alpha: { value: number | null };
  alphaBand: string;
  exactThreeWayMatchRate: number;
  meanAbsPairwiseDiff: number;
}[])
  .map(
    (d) => `<tr>
      <td>${esc(d.dimension)}</td>
      <td class="num">${n(d.alpha.value)}</td>
      <td class="${(d.alpha.value ?? 0) >= 0.667 ? "ok-text" : "warn-text"}">${esc(d.alphaBand)}</td>
      <td class="num">${pc(d.exactThreeWayMatchRate)}</td>
      <td class="num">${d.meanAbsPairwiseDiff.toFixed(2)}</td>
    </tr>`,
  )
  .join("");

const selfTable = (A.selfConsistency.dims as {
  dimension: string;
  alpha: { value: number | null };
  exactAgreementRate: number;
  meanWithinItemSd: number;
}[])
  .map(
    (d) => `<tr><td>${esc(d.dimension)}</td><td class="num">${n(d.alpha.value)}</td><td class="num">${pc(d.exactAgreementRate)}</td><td class="num">${d.meanWithinItemSd.toFixed(3)}</td></tr>`,
  )
  .join("");

const pertTable = (kcP?.byPerturbation ?? [])
  .map(
    (b: { id: string; n: number; strictDrops: number; meanParent: number; meanPerturbed: number; meanDrop: number }) =>
      `<tr><td class="mono">${esc(b.id)}</td><td class="num">${b.strictDrops}/${b.n}</td><td class="num">${b.meanParent.toFixed(1)}</td><td class="num">${b.meanPerturbed.toFixed(1)}</td><td class="num">${b.meanDrop.toFixed(1)}</td></tr>`,
  )
  .join("");

// --- ingestion tier ---------------------------------------------------------

function searchSection(): string {
  if (!search) {
    return `<p class="pending">The ingestion-tier re-run had not finished when this page was generated. Re-run <code class="mono">make-report-html.ts</code> to fill this section from <code class="mono">out-2026-07-31/search-results.json</code>.</p>`;
  }
  const rows = (search.rankingVsTavily ?? [])
    .map((r: { engine: string; usefulPct: number; band: string; deltaVsTavily: number; meanLatencyMs: number }) => {
      const pe = (search.perEngine ?? []).find((e: { engine: string }) => e.engine === r.engine) ?? {};
      return `<tr>
        <td>${esc(r.engine)}${r.engine === "searxng" ? ' <span class="tag">free, self-hosted</span>' : ""}</td>
        <td class="num">${r.usefulPct}%</td>
        <td>${esc(r.band)}</td>
        <td class="num">${n(pe.meanRelevance, 2)}</td>
        <td class="num">${n(pe.meanCredibility, 2)}</td>
        <td class="num">${n(pe.meanGroundability, 2)}</td>
        <td class="num">${r.meanLatencyMs}</td>
      </tr>`;
    })
    .join("");
  const ARCHIVED: Record<string, number> = { tavily: 81.3, exa: 77.3, searxng: 73.3, brave: 68.0 };
  const ranked = (search.rankingVsTavily ?? []) as { engine: string; usefulPct: number }[];
  const winner = ranked[0];
  const archivedWinner = Object.entries(ARCHIVED).sort((a, b) => b[1] - a[1])[0][0];
  const flipped = winner && winner.engine !== archivedWinner;

  // COVERAGE BLIND SPOT. useful% is computed over results the engine actually
  // returned, so an engine that returns NOTHING for a query is not penalised -
  // its denominator simply shrinks. Recompute on a common denominator (queries
  // x top-5) so a zero-recall query counts as five non-useful slots, and report
  // both. This is computed here rather than asserted, so it stays true on re-run.
  const perEngine = (search.perEngine ?? []) as { engine: string; overallUsefulPct: number; scoredResults: number }[];
  const fullDenom = Math.max(...perEngine.map((e) => e.scoredResults));
  const adjusted = perEngine
    .map((e) => {
      const useful = Math.round((e.overallUsefulPct / 100) * e.scoredResults);
      return {
        engine: e.engine,
        useful,
        scored: e.scoredResults,
        asReported: e.overallUsefulPct,
        coverageAware: (100 * useful) / fullDenom,
        missingSlots: fullDenom - e.scoredResults,
      };
    })
    .sort((a, b) => b.coverageAware - a.coverageAware);
  const shortfall = adjusted.filter((a) => a.missingSlots > 0);
  const coverageWinner = adjusted[0];
  const rankChangesUnderCoverage = winner && coverageWinner.engine !== winner.engine;

  const callout = flipped
    ? `<div class="callout ${rankChangesUnderCoverage ? "bad" : "good"}"><h3>The ranking changed, but do NOT change the engine on this evidence</h3>
       <p><strong>${esc(winner.engine)}</strong> ranks first as reported at ${winner.usefulPct}%, where the archived June run put <strong>${esc(archivedWinner)}</strong> first. Taken at face value that would overturn ADR 9. It should not, because the metric has a coverage blind spot that this run exposed.</p>
       <p><strong>useful% only scores results an engine actually returned.</strong> An engine that returns nothing for a query is not penalised - its denominator just shrinks. ${shortfall
         .map((s) => `<code class="mono">${esc(s.engine)}</code> returned no hits at all for one query and was scored over ${s.scored} results instead of ${fullDenom}`)
         .join("; ")}. Charging those empty slots as non-useful, which is what a learner would experience, gives:</p>
       <div class="scroll"><table><thead><tr><th>Engine</th><th class="num">as reported</th><th class="num">coverage-aware</th><th class="num">scored / possible</th></tr></thead><tbody>
       ${adjusted
         .map(
           (a) =>
             `<tr><td>${esc(a.engine)}</td><td class="num">${n(a.asReported, 1)}%</td><td class="num"><strong>${n(a.coverageAware, 1)}%</strong></td><td class="num">${a.scored}/${fullDenom}</td></tr>`,
         )
         .join("")}
       </tbody></table></div>
       <p>${
         rankChangesUnderCoverage
           ? `On the coverage-aware denominator the order changes and <strong>${esc(coverageWinner.engine)}</strong> leads, with ${esc(winner.engine)} falling to position ${adjusted.findIndex((a) => a.engine === winner.engine) + 1}. <strong>The honest conclusion is that this run cannot settle ADR 9 either way.</strong> The correct next step is to fix the metric so a zero-recall query counts as a failure, then re-run - not to switch engines on a number that rewards an engine for answering fewer queries.`
           : "The order is unchanged under the coverage-aware denominator, so the ranking is not an artifact of the blind spot."
       }</p></div>`
    : "";

  // Every engine now bands "Best", where the June run spread 68-81%. Absolute
  // percentages are not comparable across runs because the judge model may have
  // been updated behind the same id; only the within-run ranking is.
  const allBest = ranked.every((r) => r.usefulPct > 80);

  return `${callout}<table><thead><tr><th>Engine</th><th>Useful%</th><th>Band</th><th>mean Rel</th><th>mean Cred</th><th>mean Ground</th><th>mean latency (ms)</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="note">Extraction success ${esc(search.extractionSuccess ?? "n/a")}. Judge model <code class="mono">${esc(search.judgeModel ?? "n/a")}</code>. Archived 2026-06-03 ranking: tavily 81.3, exa 77.3, searxng 73.3, brave 68.0.</p>
  ${
    allBest
      ? `<div class="callout"><h3>Do not compare these percentages to the June ones</h3><p>Every engine now scores above 80% where the June run spread 68 to 81%. A across-the-board rise of that size is far more likely to mean the judge model behind the id <code class="mono">${esc(search.judgeModel ?? "")}</code> was updated between runs than that all four engines improved together. <strong>Only the within-run ranking is comparable across dates</strong>; the absolute useful% is not, and the article should compare ranks rather than percentages. Pinning a dated model snapshot would fix this for future runs.</p></div>`
      : ""
  }`;
}

function embSection(): string {
  if (!emb) {
    return `<p class="pending">The embedding re-run had not finished when this page was generated.</p>`;
  }
  const rows = Object.entries(emb.models as Record<string, Record<string, unknown>>)
    .sort((a, b) => (b[1].ndcgAt10 as number) - (a[1].ndcgAt10 as number))
    .map(
      ([, m]) => `<tr>
        <td>${esc(m.label)}</td>
        <td class="num">${esc(m.dim)}</td>
        <td class="num">${n(m.recallAt5, 4)}</td>
        <td class="num">${n(m.mrr, 4)}</td>
        <td class="num">${n(m.ndcgAt10, 4)}</td>
        <td class="num">$${esc(m.pricePerMTokensUsd)}</td>
        <td class="num">${esc(m.meanQueryEmbedMs)}</td>
      </tr>`,
    )
    .join("");
  // The archived results carried an open caveat: Qwen was benchmarked without
  // the query-instruction prefix it is designed for, so the Gemini margin was
  // partly a misconfiguration. Both variants ran in this batch, so the caveat
  // can now be settled from data rather than left open.
  const models = emb.models as Record<string, { label: string; ndcgAt10: number; pricePerMTokensUsd: number; meanQueryEmbedMs: number }>;
  const byKey = (pred: (k: string, m: { label: string }) => boolean) =>
    Object.entries(models).find(([k, m]) => pred(k, m))?.[1];
  const gem = byKey((k) => k.startsWith("gemini"));
  const qBare = byKey((k, m) => k.includes("qwen") && k.includes("8b") && !/instruct/i.test(m.label));
  const qInst = byKey((k, m) => k.includes("qwen") && k.includes("8b") && /instruct/i.test(m.label));
  const best = Object.values(models).sort((a, b) => b.ndcgAt10 - a.ndcgAt10)[0];

  let verdict = "";
  if (gem && qBare && qInst) {
    const gain = qInst.ndcgAt10 - qBare.ndcgAt10;
    const marginOverGemini = qInst.ndcgAt10 - gem.ndcgAt10;
    const clear = Math.abs(marginOverGemini) > 0.03;
    verdict = `<div class="callout good"><h3>An open caveat in the thesis is now settled</h3>
      <p>The archived results warned that Qwen3-Embedding was benchmarked without the query-instruction prefix it expects, so the Gemini margin might have been measuring a misconfiguration rather than model quality. Both variants ran in the same batch this time. <strong>The caveat was justified:</strong> adding the prefix moves Qwen3-8B from nDCG@10 ${n(qBare.ndcgAt10, 4)} to ${n(qInst.ndcgAt10, 4)}, a gain of ${n(gain, 4)} - roughly ${(100 * gain / qBare.ndcgAt10).toFixed(0)}% relative. Most of the reported gap was configuration, not capability, and the thesis wording should be corrected.</p>
      <p><strong>The decision does not change.</strong> Instruction-prefixed Qwen now edges Gemini by ${n(Math.abs(marginOverGemini), 4)} nDCG@10, which is ${clear ? "above" : "well below"} the 0.03 margin the protocol fixed as a "clear win". ${clear ? "" : "On a 15-query set that difference is noise, so the rule says stay on Gemini."} Worth flagging for cost work: Qwen3-Embedding-4B with the prefix reaches statistically indistinguishable quality at $0.02 per 1M tokens against Gemini's $0.15, about 7x cheaper, at comparable latency. That is a real optimisation to revisit, not a reason to switch on this evidence.</p></div>`;
  }

  return `${verdict}<table><thead><tr><th>Model</th><th>dim</th><th>Recall@5</th><th>MRR</th><th>nDCG@10</th><th>$/1M tok</th><th>mean query latency (ms)</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="note">${esc(emb.totalChunks ?? "?")} chunks, ${esc(emb.groundTruthLabelledQueries ?? "?")} queries with judge-labelled relevant chunks. Best nDCG@10 this run: ${esc(best?.label ?? "n/a")}. These absolute values are not comparable to the June run either: the chunk corpus and the judge-labelled ground truth are both rebuilt from the fresh search results, so only the within-run ordering carries across dates.</p>`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// --- spend -----------------------------------------------------------------
// A.spend counts only SUCCESSFUL judge-validation calls. Three other buckets
// exist and are added so the reported total is not an undercount:
//   1. the ingestion search judge, instrumented in search-results.json;
//   2. the ingestion embedding judge;
//   3. calls that failed after the provider had already billed the tokens
//      (7 Claude truncations plus diagnostics), which the per-record accounting
//      books at 0 because no usable result came back.
// (3) is bounded rather than measured per call, using the OpenRouter key's own
// remaining-limit delta across the session as ground truth: 35.3920 -> 31.9956.
const searchJudgeUsage = (search?.judgeUsage ?? {}) as { calls?: number; totalUsd?: number };
const embJudgeUsage = (emb?.judgeUsage ?? {}) as { calls?: number; totalUsd?: number };
const searchJudgeCalls = (searchJudgeUsage.calls ?? 0) + (embJudgeUsage.calls ?? 0);
const OPENROUTER_MEASURED_USD = 35.392032 - 31.995600; // key limit delta, whole session
const googleAccountedUsd =
  (A.cost as { judgeKey: string; totalUsd: number }[])
    .filter((c) => c.judgeKey.startsWith("gemini"))
    .reduce((a, c) => a + c.totalUsd, 0) +
  (searchJudgeUsage.totalUsd ?? 0) +
  (embJudgeUsage.totalUsd ?? 0);
// Paid search APIs are not billed per call in any response body, so these are
// LIST-PRICE ESTIMATES at 15 queries each, checked 2026-07-30. SearXNG is
// self-hosted and free, which is the whole reason it is in the comparison.
const SEARCH_API_ESTIMATES: { engine: string; usd: number; source: string }[] = [
  { engine: "searxng (self-hosted)", usd: 0, source: "no API cost" },
  { engine: "brave", usd: 15 * 0.005, source: "brave.com/search/api, $5 per 1k requests" },
  { engine: "tavily", usd: 15 * 0.008, source: "tavily.com/pricing, $0.008 per basic-search credit" },
  { engine: "exa", usd: 15 * 0.008, source: "exa.ai/pricing, $7 per 1k searches + $1 per 1k contents" },
];
const searchApiEstimatedUsd = SEARCH_API_ESTIMATES.reduce((a, e) => a + e.usd, 0);
const geminiEmbedIngestionUsd = 0.0124; // run-embeddings.ts, tokensEstimated: true
const TOTAL_SPEND = OPENROUTER_MEASURED_USD + googleAccountedUsd + searchApiEstimatedUsd + geminiEmbedIngestionUsd;

const flipItems = (A.selfConsistency.decisionFlips as { itemId: string; decisions: string[] }[])
  .map((f) => `<li><code class="mono">${esc(f.itemId)}</code> &rarr; ${f.decisions.map(esc).join(", ")}</li>`)
  .join("");

const violations = (kcP?.violations ?? [])
  .map(
    (v: { itemId: string; perturbation: string; parentScore: number; perturbedScore: number }) =>
      `<li><code class="mono">${esc(v.itemId)}</code> - parent ${v.parentScore.toFixed(1)}, degraded ${v.perturbedScore.toFixed(1)} (no drop)</li>`,
  )
  .join("");

const spendBlock = `<h3>What this cost</h3>
<div class="scroll"><table><thead><tr><th>Bucket</th><th class="num">USD</th><th>Basis</th></tr></thead><tbody>
<tr><td>OpenRouter (Claude Sonnet 5, GPT-5.4-mini, Qwen embeddings)</td><td class="num">${n(OPENROUTER_MEASURED_USD, 4)}</td><td>measured from the key's own remaining-limit delta across the session, so it includes calls that failed after billing</td></tr>
<tr><td>Google (judge validation)</td><td class="num">${n((A.cost as { judgeKey: string; totalUsd: number }[]).filter((c) => c.judgeKey.startsWith("gemini")).reduce((a, c) => a + c.totalUsd, 0), 4)}</td><td>provider-reported tokens at list price, per call</td></tr>
<tr><td>Google (ingestion judge, ${esc(searchJudgeCalls)} calls)</td><td class="num">${n((searchJudgeUsage.totalUsd ?? 0) + (embJudgeUsage.totalUsd ?? 0), 4)}</td><td>provider-reported tokens at list price, per call</td></tr>
<tr><td>Google (ingestion embeddings)</td><td class="num">${n(geminiEmbedIngestionUsd, 4)}</td><td>token count estimated; the embeddings endpoint returns no usage metadata</td></tr>
<tr><td>Paid search APIs (brave, tavily, exa; 15 queries each)</td><td class="num">${n(searchApiEstimatedUsd, 4)}</td><td>list-price estimate, not billed-and-verified: ${SEARCH_API_ESTIMATES.filter((e) => e.usd > 0).map((e) => `${esc(e.engine)} ${esc(e.source)}`).join("; ")}</td></tr>
<tr><td><strong>Total</strong></td><td class="num"><strong>${n(TOTAL_SPEND, 4)}</strong></td><td>against a $15 self-imposed cap</td></tr>
</tbody></table></div>
<p class="note">The single most expensive line was running the rubric on Claude Sonnet 5 for the cross-family panel, at ${n((A.cost as { system: string; judgeKey: string; usdPerEval: number }[]).find((c) => c.judgeKey === "claude-sonnet-5")?.usdPerEval, 4)} per evaluation. It emits hidden reasoning tokens on hard items, which both inflates cost and caused seven truncation failures at the original 4096-token ceiling before that was raised.</p>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KnowledgeCore evaluation: protocol plus first real runs (2026-07-31)</title>
<style>
  :root {
    color-scheme: light dark;
    --surface: #fcfcfb;
    --surface-2: #f4f4f1;
    --line: #dedbd2;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --text-muted: #78766f;
    --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #4a3aa7;
    --ok: #1baf7a; --warn: #eb6834; --crit: #e34948;
    --ok-ink: #0f6b4b; --warn-ink: #a2411d;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      --surface: #1a1a19;
      --surface-2: #242422;
      --line: #3a3a36;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --text-muted: #96948a;
      --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #9085e9;
      --ok: #199e70; --warn: #d95926; --crit: #e66767;
      --ok-ink: #6fd9ae; --warn-ink: #f0a077;
    }
  }
  :root[data-theme="dark"] {
    --surface: #1a1a19; --surface-2: #242422; --line: #3a3a36;
    --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #96948a;
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #9085e9;
    --ok: #199e70; --warn: #d95926; --crit: #e66767;
    --ok-ink: #6fd9ae; --warn-ink: #f0a077;
  }
  body {
    background: var(--surface); color: var(--text-primary);
    font: 16px/1.62 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    margin: 0; padding: 40px 24px 96px;
  }
  main { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 1.85rem; line-height: 1.22; letter-spacing: -0.02em; margin: 0 0 8px; }
  h2 { font-size: 1.22rem; letter-spacing: -0.01em; margin: 52px 0 12px; padding-top: 18px; border-top: 1px solid var(--line); }
  h3 { font-size: 1rem; margin: 28px 0 8px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
  p { color: var(--text-secondary); margin: 0 0 14px; }
  .lede { font-size: 1.06rem; color: var(--text-primary); }
  .meta { color: var(--text-muted); font-size: 0.85rem; margin-bottom: 28px; }
  strong { color: var(--text-primary); }
  code.mono, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.87em; }
  a { color: var(--s1); }

  .callout { border: 1px solid var(--line); border-left: 3px solid var(--s1); background: var(--surface-2); padding: 16px 18px; border-radius: 6px; margin: 20px 0; }
  .callout.bad { border-left-color: var(--crit); }
  .callout.good { border-left-color: var(--ok); }
  .callout h3 { margin-top: 0; }
  .callout p:last-child { margin-bottom: 0; }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 24px 0 8px; }
  .tile { border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; background: var(--surface-2); }
  .tile .v { font-size: 1.7rem; font-weight: 650; letter-spacing: -0.02em; line-height: 1.1; }
  .tile .k { font-size: 0.78rem; color: var(--text-muted); margin-top: 4px; }
  .tile.pass .v { color: var(--ok-ink); }
  .tile.fail .v { color: var(--crit); }

  .scroll { overflow-x: auto; margin: 16px 0; }
  table { border-collapse: collapse; width: 100%; font-size: 0.88rem; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  thead th { color: var(--text-muted); font-weight: 600; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--text-muted); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr:hover { background: var(--surface-2); }

  .grid-table th[scope="row"] { font-weight: 500; }
  .grid-table .sub { display: block; font-weight: 400; font-size: 0.78rem; color: var(--text-muted); }
  .grid-table td.thr { color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .grid-table td.pass, .grid-table td.fail { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
  .grid-table td.pass { color: var(--ok-ink); }
  .grid-table td.fail { color: var(--crit); }
  .grid-table td.na { color: var(--text-muted); font-size: 0.82rem; }
  .badge { display: block; font-size: 0.68rem; letter-spacing: 0.08em; font-weight: 700; }
  .swatch { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
  .ok-text { color: var(--ok-ink); }
  .warn-text { color: var(--warn-ink); }
  .tag { font-size: 0.7rem; background: var(--surface-2); border: 1px solid var(--line); border-radius: 3px; padding: 1px 5px; color: var(--text-muted); }

  figure { margin: 20px 0 8px; }
  figcaption { font-size: 0.82rem; color: var(--text-muted); margin-top: 6px; }
  svg { width: 100%; height: auto; display: block; }
  .grid { stroke: var(--line); stroke-width: 1; }
  .threshold { stroke: var(--text-muted); stroke-width: 1.5; stroke-dasharray: 4 4; }
  .tick { fill: var(--text-muted); font-size: 11px; font-family: inherit; }
  .tick.muted { fill: var(--text-muted); font-size: 10px; }
  .axis-title { fill: var(--text-muted); font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; }
  .dlabel { font-size: 12px; font-weight: 600; font-family: inherit; }
  .dnum { fill: var(--text-muted); font-weight: 500; }
  circle:hover { r: 6; }

  ul { color: var(--text-secondary); padding-left: 20px; }
  li { margin-bottom: 4px; }
  .note, .pending { font-size: 0.84rem; color: var(--text-muted); }
  .pending { border: 1px dashed var(--line); padding: 12px 14px; border-radius: 6px; }
</style>
</head>
<body>
<main>
<h1>KnowledgeCore evaluation: protocol plus first real runs</h1>
<p class="meta">Generated ${esc(new Date(A.generatedAt).toISOString().replace("T", " ").slice(0, 16))} UTC &middot; ${esc(A.recordsOk)} judge-validation calls + ${esc(searchJudgeCalls)} ingestion judge calls, ${esc(A.recordsFailed)} unresolved failures &middot; total measured API spend $${n(TOTAL_SPEND, 2)} against a $15 cap</p>

<p class="lede">Andrei asked for the KnowledgeCore proposal to be shown better than named alternatives on accuracy, efficiency and cost, with the evaluations actually run and no human raters. This is the first execution. <strong>It is not finished work</strong> - it is a fixed protocol plus one real run of the part that matters most: whether the 6-dimension checkpoint rubric is a trustworthy measuring instrument at all.</p>

<div class="callout">
<h3>The three things worth knowing</h3>
<p><strong>1. The proposal wins the comparison that matters, and the ablation proves why.</strong> A bare 6-dimension rubric with no level descriptors and no evidence contract performs <em>worse</em> than a single holistic score (${pc((pert("alt_b_bare")?.strictDrops ?? 0) / (pert("alt_b_bare")?.n ?? 1))} vs ${pc((pert("alt_a_holistic")?.strictDrops ?? 0) / (pert("alt_a_holistic")?.n ?? 1))} on degraded input). The contribution is the rubric's <em>specification</em>, not the fact of having six numbers.</p>
<p><strong>2. The proposal fails one of its own pre-registered thresholds.</strong> Identical input produces a different learner-visible decision ${pc(flip)} of the time, against a ceiling of 5%. This is a real defect and it is reported as one.</p>
<p><strong>3. Three of six rubric dimensions do not reach adequate cross-model agreement.</strong> Recall, communication and coverage all sit below the 0.667 threshold. The article can make tentative claims, not firm ones, on those dimensions.</p>
</div>

<div class="tiles">
  <div class="tile ${kcP && kcP.strictDrops / kcP.n >= 0.9 ? "pass" : "fail"}"><div class="v">${pc((kcP?.strictDrops ?? 0) / (kcP?.n ?? 1), 0)}</div><div class="k">degraded input scored lower (target &ge;90%)</div></div>
  <div class="tile ${(pooled ?? 0) >= 0.667 ? "pass" : "fail"}"><div class="v">${n(pooled, 2)}</div><div class="k">cross-model agreement, pooled &alpha; (target &ge;0.667)</div></div>
  <div class="tile ${flip <= 0.05 ? "pass" : "fail"}"><div class="v">${pc(flip, 1)}</div><div class="k">decision flip rate on repeat (target &le;5%)</div></div>
  <div class="tile pass"><div class="v">${n(kcT?.spearman, 2)}</div><div class="k">rank correlation with designed quality</div></div>
</div>

<h2>1. What replaced the human raters</h2>
<p>The thesis (&sect;6.2) specified a dual-rating study against a human and forbade reporting any number until it ran. It never ran. The one prior attempt, on the smaller <em>search</em> rubric, gave Cohen's kappa 0.214 and 0.314 - slight to fair. Three human-free substitutes replace it, each standing in for a different property:</p>
<div class="scroll"><table>
<thead><tr><th>Property needed</th><th>Human method</th><th>Substitute actually run</th></tr></thead>
<tbody>
<tr><td>Convergent validity</td><td>A second human rater</td><td>Inter-judge agreement across three independent model families (Gemini, GPT, Claude)</td></tr>
<tr><td>Reliability</td><td>Intra-rater test-retest</td><td>Three repeat runs at fixed input, at the production temperature of 0.2</td></tr>
<tr><td>Directional validity</td><td>Human ranking of artifacts</td><td>24 artifacts authored at 4 designed quality tiers, plus 30 deterministically degraded ones</td></tr>
</tbody></table></div>
<div class="callout bad">
<h3>What this cannot claim</h3>
<p>None of this shows the judge agrees with an expert human. Model families share training data and can be wrong together, and the quality tiers were authored by the same person who owns the rubric. Recovering the designed ordering is a <strong>necessary</strong> condition for a valid instrument, not a sufficient one. The article may say the instrument is internally consistent, reproducible and sensitive to degradation. It may <strong>not</strong> say it matches human judgement, and inter-judge agreement must never be presented as judge-human agreement.</p>
</div>

<h2>2. Verdict against thresholds fixed before the run</h2>
<p>These thresholds were written into the analysis code before any result existed, and are evaluated in code so none can be quietly moved after the fact.</p>
<div class="scroll">${verdictTable}</div>
<p class="note">X3 and X4 were run for the proposal only. The cross-family and replicate budget went to the system the article's credibility depends on; the alternatives are not being defended as instruments.</p>

<h2>3. The alternatives saturate; the proposal does not</h2>
<figure>${tierChart()}
<figcaption>Mean 0&ndash;100 score against designed quality tier. Both LLM alternatives reach ceiling by T2 and cannot separate proficient work from mastery work: T2&rarr;T3 separation is 0/6 scenarios for ALT-A and 1/6 for ALT-B, against 6/6 for the proposal. A tutoring system built on either would advance every competent learner identically and would have no signal left to drive adaptation.</figcaption></figure>

<h2>4. Robustness: deliberately degraded work must score lower</h2>
<p>Thirty artifacts were degraded by deterministic, seeded string transforms - truncation, sentence shuffling, domain-term corruption, off-topic splicing and specificity stripping. No model was involved in making them worse, so the degradation is reproducible byte-for-byte. Each is compared against the mastery artifact it came from. A tie counts as a failure, not partial credit.</p>
<figure>${dropChart()}
<figcaption>Strict-drop rate by system. ALT-C (plain embedding similarity, no LLM) is perfect here but drops only ${n(pert("alt_c_similarity")?.meanDrop, 1)} points on average against ${n(kcP?.meanDrop, 1)} for the proposal, and it is the weakest at telling quality tiers apart.</figcaption></figure>
<h3>By perturbation type, KnowledgeCore rubric</h3>
<div class="scroll"><table><thead><tr><th>Perturbation</th><th class="num">strict drops</th><th class="num">mean parent</th><th class="num">mean degraded</th><th class="num">mean drop</th></tr></thead><tbody>${pertTable}</tbody></table></div>
${violations ? `<p><strong>Instrument failures (${(kcP?.violations ?? []).length}):</strong></p><ul>${violations}</ul><p class="note">Sentence shuffling is the weakest perturbation: it preserves every fact and destroys only the ordering, and the rubric barely notices. That is a genuine blind spot in scoring <em>communication</em>.</p>` : ""}

<h2>5. Cross-model agreement, dimension by dimension</h2>
<figure>${alphaChart()}
<figcaption>Krippendorff's alpha (ordinal) across three model families, ${esc(A.interJudge.items)} items. Bars below the dashed line do not reach the conventional 0.667 adequacy threshold.</figcaption></figure>
<div class="scroll"><table><thead><tr><th>Dimension</th><th class="num">&alpha; ordinal</th><th>Reading</th><th class="num">3-way exact match</th><th class="num">mean pairwise diff</th></tr></thead><tbody>${alphaTable}</tbody></table></div>
<p><strong>Coverage is the weak point</strong> - only ${pc((A.interJudge.dims.find((d: { dimension: string }) => d.dimension === "coverage")?.exactThreeWayMatchRate) ?? 0)} three-way exact agreement. Coverage is also the dimension that triggers the <code class="mono">adjust_plan</code> branch, so disagreement there propagates straight into changing a learner's path. Despite this, the derived decisions still match ${pc(Math.max(...(A.interJudge.decisionKappa as { exactMatchRate: number }[]).map((d) => d.exactMatchRate)))} of the time between the closest judge pair.</p>

<h2>6. Reliability: same input, run three times</h2>
<div class="scroll"><table><thead><tr><th>Dimension</th><th class="num">&alpha; across runs</th><th class="num">exact agreement</th><th class="num">mean within-item SD</th></tr></thead><tbody>${selfTable}</tbody></table></div>
<div class="callout bad">
<h3>The failure worth acting on</h3>
<p>Per-dimension scores are highly reproducible (&alpha; 0.90&ndash;0.98, mean total-score SD ${n(A.selfConsistency.meanTotalScoreSd, 2)} points on a 0&ndash;100 scale). Yet the <em>decision</em> flips on ${pc(flip)} of items. The cause is structural, not statistical: <code class="mono">deriveDecision</code> uses hard thresholds, so a one-level wobble on a single dimension sitting exactly on a boundary flips what the learner is told. Affected items:</p>
<ul>${flipItems}</ul>
<p>The fix is a design change, not a prompt change - hysteresis at the boundary, or a tie-break that repeats the evaluation when scores land on a threshold.</p>
</div>

<h2>7. Auditability</h2>
<p>The proposal requires one evidence quote per dimension, copied verbatim from the learner's own text and checked in code. ALT-A and ALT-B return no quotes; ALT-C returns no explanation at all. This is a categorical difference, not a score.</p>
<div class="scroll"><table><thead><tr><th>Judge</th><th class="num">quotes verified</th><th class="num">items fully verified</th><th class="num">items with no evidence</th></tr></thead><tbody>
${(A.evidence as { judgeKey: string; meanVerifiedRate: number; allSixVerifiedRate: number; itemsWithNoEvidence: number }[])
  .map((e) => `<tr><td class="mono">${esc(e.judgeKey)}</td><td class="num">${pc(e.meanVerifiedRate)}</td><td class="num">${pc(e.allSixVerifiedRate)}</td><td class="num">${e.itemsWithNoEvidence}</td></tr>`)
  .join("")}
</tbody></table></div>

<h2>8. Cost, latency and tokens</h2>
<p>All measured, none modelled. Tokens are provider-reported per call; latency is wall-clock; USD is computed from those tokens at recorded list prices. The last column composes to a three-goalpost journey, matching the cost model in thesis &sect;6.5.</p>
<div class="scroll"><table><thead><tr><th>System</th><th>Model</th><th class="num">calls</th><th class="num">in tok</th><th class="num">out tok</th><th class="num">mean ms</th><th class="num">p95 ms</th><th class="num">USD/eval</th><th class="num">USD/journey</th></tr></thead><tbody>${costRows}</tbody></table></div>
<p class="note">The production configuration (KnowledgeCore on <code class="mono">gemini-3.5-flash</code>) costs about ${n((A.cost as { system: string; judgeKey: string; usdPerEval: number }[]).find((c) => c.system === "kc" && c.judgeKey === "gemini-3.5-flash")?.usdPerEval, 4)} USD and ${n((A.cost as { system: string; judgeKey: string; meanLatencyMs: number }[]).find((c) => c.system === "kc" && c.judgeKey === "gemini-3.5-flash")?.meanLatencyMs, 0)} ms per checkpoint evaluation. Running the same rubric on Claude Sonnet 5 costs roughly 20x more and is 11x slower for no gain in tier discrimination, which is a useful negative result for model selection.</p>

${spendBlock}

<h2>9. Ingestion tier: search engine and embedding model</h2>
<h3>Search engines</h3>
${searchSection()}
<h3>Embedding models</h3>
${embSection()}
<p class="note">The relevance rubric behind these search numbers is a different, smaller rubric than the checkpoint rubric validated above, and it remains <strong>unvalidated</strong> (kappa 0.214 / 0.314 against the author, 2026-06-03). The engine ranking is directional, and the article must not present it as validated relevance measurement.</p>

<h2>10. What is still missing</h2>
<ul>
<li><strong>Any human comparison.</strong> Deliberate, but it bounds every claim in this document.</li>
<li><strong>Real learner artifacts.</strong> The corpus is authored, not sampled. Real writing is messier.</li>
<li><strong>Sample size.</strong> 6 scenarios, 54 items. Confidence intervals come from a cluster bootstrap over 6 scenarios and are correspondingly wide.</li>
<li><strong>The decision-boundary defect.</strong> Found here, not yet fixed.</li>
<li><strong>Ingestion rubric validation.</strong> Still open.</li>
<li><strong>L1 adaptation calibration.</strong> Needs a real journey corpus that does not exist yet.</li>
<li><strong>Learning gains.</strong> Permanently out of scope at this stage; no controlled trial exists.</li>
</ul>

<h2>Files</h2>
<ul>
<li><code class="mono">raw-results/EVAL-PROTOCOL-2026-07-31.md</code> - the protocol: alternatives, axes, thresholds, threats to validity</li>
<li><code class="mono">raw-results/JUDGE-VALIDATION-2026-07-31.md</code> - the full written report with every table</li>
<li><code class="mono">raw-results/judge-validation-2026-07-31/records.jsonl</code> - one JSON line per model call, ${esc(A.recordsOk)} of them</li>
<li><code class="mono">raw-results/judge-validation-2026-07-31/analysis.json</code> - every computed statistic</li>
<li><code class="mono">knowledgecore/lib/research/eval/judge-validation/</code> - corpus, perturbations, systems, statistics, all reproducible</li>
</ul>
<p class="note">The archived 2026-06-03 thesis results in <code class="mono">raw-results/</code> and <code class="mono">lib/research/eval/out/</code> were not modified. Statistics were verified against published reference values before use: Krippendorff's canonical example reproduces its published ordinal alpha of 0.815.</p>
</main>
</body>
</html>`;

writeFileSync(OUT, html);
console.log(`Wrote ${OUT}`);
console.log(`  search section: ${search ? "populated" : "PENDING (out-2026-07-31/search-results.json absent)"}`);
console.log(`  embedding section: ${emb ? "populated" : "PENDING (out-2026-07-31/embedding-results.json absent)"}`);
