/**
 * Cohen's kappa between the founder's ratings and the LLM judge's answer key.
 *
 * Inputs:
 *   1. founder JSON  (from the rating sheet's "copy results as JSON")
 *   2. answer key    lib/research/eval/out/kappa-judge-scores.json
 *
 * Run: bun run scripts/compute-kappa.ts <founder-ratings.json> [answer-key.json]
 *
 * We report kappa TWO ways per axis (relevance, credibility):
 *   - collapsed binary "useful" agreement: score 2 (best) vs <2  (the band rule
 *     keys off the top score, so this is the operationally relevant kappa);
 *   - quadratic-weighted kappa over the full 0/1/2 ordinal scale (penalises a
 *     0-vs-2 disagreement more than 1-vs-2), the standard for ordinal ratings.
 * Both are documented; the CHARTER C.1 study can cite whichever matches its design.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

interface FounderRating { itemId: string; relevance: number | null; credibility: number | null }
interface KeyItem { itemId: string; judgeRelevance: number; judgeCredibility: number }

function cohenKappaBinary(a: number[], b: number[]): number {
  const n = a.length;
  if (n === 0) return NaN;
  let agree = 0;
  let a1 = 0;
  let b1 = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree++;
    a1 += a[i];
    b1 += b[i];
  }
  const po = agree / n;
  const pa1 = a1 / n;
  const pb1 = b1 / n;
  const pe = pa1 * pb1 + (1 - pa1) * (1 - pb1);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

/** Quadratic-weighted kappa over an ordinal scale 0..maxCat. */
function weightedKappa(a: number[], b: number[], maxCat = 2): number {
  const n = a.length;
  if (n === 0) return NaN;
  const C = maxCat + 1;
  const O = Array.from({ length: C }, () => new Array(C).fill(0));
  const rowA = new Array(C).fill(0);
  const colB = new Array(C).fill(0);
  for (let i = 0; i < n; i++) {
    O[a[i]][b[i]]++;
    rowA[a[i]]++;
    colB[b[i]]++;
  }
  const w = (i: number, j: number) => ((i - j) * (i - j)) / (maxCat * maxCat);
  let num = 0;
  let den = 0;
  for (let i = 0; i < C; i++) {
    for (let j = 0; j < C; j++) {
      const e = (rowA[i] * colB[j]) / n;
      num += w(i, j) * O[i][j];
      den += w(i, j) * e;
    }
  }
  return den === 0 ? 1 : 1 - num / den;
}

function interpret(k: number): string {
  if (Number.isNaN(k)) return "n/a";
  if (k < 0) return "worse than chance";
  if (k < 0.2) return "slight";
  if (k < 0.4) return "fair";
  if (k < 0.6) return "moderate";
  if (k < 0.8) return "substantial";
  return "almost perfect";
}

function main() {
  const founderPath = process.argv[2];
  if (!founderPath) {
    console.error("Usage: bun run scripts/compute-kappa.ts <founder-ratings.json> [answer-key.json]");
    process.exit(1);
  }
  const keyPath = process.argv[3] ?? join(fileURLToPath(new URL(".", import.meta.url)), "..", "lib", "research", "eval", "out", "kappa-judge-scores.json");

  const founder = JSON.parse(readFileSync(founderPath, "utf8")) as { ratings: FounderRating[] };
  const key = JSON.parse(readFileSync(keyPath, "utf8")) as { items: KeyItem[] };
  const keyById = new Map(key.items.map((k) => [k.itemId, k]));

  const relF: number[] = [];
  const relJ: number[] = [];
  const credF: number[] = [];
  const credJ: number[] = [];
  let skipped = 0;

  for (const r of founder.ratings) {
    const k = keyById.get(r.itemId);
    if (!k || r.relevance == null || r.credibility == null) {
      skipped++;
      continue;
    }
    relF.push(r.relevance);
    relJ.push(k.judgeRelevance);
    credF.push(r.credibility);
    credJ.push(k.judgeCredibility);
  }

  const bin = (arr: number[]) => arr.map((v) => (v === 2 ? 1 : 0));

  const report = {
    n: relF.length,
    skipped,
    relevance: {
      binaryUsefulKappa: Number(cohenKappaBinary(bin(relF), bin(relJ)).toFixed(4)),
      quadraticWeightedKappa: Number(weightedKappa(relF, relJ).toFixed(4)),
    },
    credibility: {
      binaryUsefulKappa: Number(cohenKappaBinary(bin(credF), bin(credJ)).toFixed(4)),
      quadraticWeightedKappa: Number(weightedKappa(credF, credJ).toFixed(4)),
    },
  };

  console.log(JSON.stringify(report, null, 2));
  console.log("");
  console.log(`n = ${report.n} (skipped ${report.skipped})`);
  console.log(`Relevance   — binary(2-vs-<2) k=${report.relevance.binaryUsefulKappa} (${interpret(report.relevance.binaryUsefulKappa)}); quadratic-weighted k=${report.relevance.quadraticWeightedKappa} (${interpret(report.relevance.quadraticWeightedKappa)})`);
  console.log(`Credibility — binary(2-vs-<2) k=${report.credibility.binaryUsefulKappa} (${interpret(report.credibility.binaryUsefulKappa)}); quadratic-weighted k=${report.credibility.quadraticWeightedKappa} (${interpret(report.credibility.quadraticWeightedKappa)})`);
}

main();
