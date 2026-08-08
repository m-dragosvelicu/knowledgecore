/**
 * Agreement and correlation statistics for the judge-validation study.
 *
 * Implemented here rather than pulled from a library so every formula used in
 * the write-up is inspectable and so degenerate cases are surfaced rather than
 * silently returning a number. Degenerate cases are NOT hypothetical in this
 * study: a rubric dimension on which every rater gives the same value has zero
 * expected disagreement, and kappa/alpha are then genuinely undefined. Those
 * return null with a stated reason instead of 0 or 1, because reporting a
 * fabricated 0 would understate agreement and a fabricated 1 would overstate it.
 */

export type Maybe = number | null;

export interface StatWithReason {
  value: Maybe;
  /** Populated only when value is null. */
  undefinedReason?: string;
  n: number;
}

// ---------------------------------------------------------------------------
// Ranks and correlation
// ---------------------------------------------------------------------------

/** Average ranks, 1-based, ties averaged. */
export function rank(values: number[]): number[] {
  const idx = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
    const avg = (i + j + 2) / 2; // mean of 1-based ranks i+1..j+1
    for (let k = i; k <= j; k++) out[idx[k].i] = avg;
    i = j + 1;
  }
  return out;
}

export function pearson(x: number[], y: number[]): Maybe {
  const n = x.length;
  if (n < 2) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null; // one series is constant
  return num / Math.sqrt(dx * dy);
}

export function spearman(x: number[], y: number[]): StatWithReason {
  if (x.length !== y.length) throw new Error("spearman: length mismatch");
  if (x.length < 3) return { value: null, undefinedReason: "fewer than 3 paired observations", n: x.length };
  const r = pearson(rank(x), rank(y));
  if (r === null) {
    return { value: null, undefinedReason: "one series has zero rank variance (all values tied)", n: x.length };
  }
  return { value: r, n: x.length };
}

// ---------------------------------------------------------------------------
// Cohen's kappa, quadratic weights
// ---------------------------------------------------------------------------

/**
 * Quadratic-weighted Cohen's kappa over an integer category range.
 * Returns null when expected weighted disagreement is zero, which happens when
 * at least one rater used a single category throughout.
 */
export function quadraticWeightedKappa(a: number[], b: number[], minCat: number, maxCat: number): StatWithReason {
  const n = a.length;
  if (n === 0) return { value: null, undefinedReason: "no paired observations", n: 0 };
  const k = maxCat - minCat + 1;
  if (k < 2) return { value: null, undefinedReason: "fewer than 2 categories", n };

  const O = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const rowM = new Array<number>(k).fill(0);
  const colM = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    const ai = a[i] - minCat;
    const bi = b[i] - minCat;
    O[ai][bi] += 1;
    rowM[ai] += 1;
    colM[bi] += 1;
  }

  let numer = 0;
  let denom = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const w = ((i - j) * (i - j)) / ((k - 1) * (k - 1));
      numer += w * O[i][j];
      denom += (w * rowM[i] * colM[j]) / n;
    }
  }
  if (denom === 0) {
    return {
      value: null,
      undefinedReason: "expected weighted disagreement is zero (at least one rater used a single category throughout)",
      n,
    };
  }
  return { value: 1 - numer / denom, n };
}

/** Unweighted Cohen's kappa over arbitrary string categories. */
export function cohenKappaNominal(a: string[], b: string[]): StatWithReason {
  const n = a.length;
  if (n === 0) return { value: null, undefinedReason: "no paired observations", n: 0 };
  const cats = [...new Set([...a, ...b])];
  const idx = new Map(cats.map((c, i) => [c, i]));
  const k = cats.length;
  if (k < 2) {
    return { value: null, undefinedReason: "only one category observed across both raters", n };
  }
  const O = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const rowM = new Array<number>(k).fill(0);
  const colM = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    const ai = idx.get(a[i])!;
    const bi = idx.get(b[i])!;
    O[ai][bi] += 1;
    rowM[ai] += 1;
    colM[bi] += 1;
  }
  let po = 0;
  let pe = 0;
  for (let i = 0; i < k; i++) {
    po += O[i][i] / n;
    pe += (rowM[i] / n) * (colM[i] / n);
  }
  if (pe === 1) {
    return { value: null, undefinedReason: "chance agreement is 1 (degenerate marginals)", n };
  }
  return { value: (po - pe) / (1 - pe), n };
}

/**
 * Fleiss' kappa (Fleiss, 1971) for a fixed number of raters (n >= 2) rating
 * every unit into one of k nominal/ordinal categories.
 *
 * WHY THIS EXISTS ALONGSIDE KRIPPENDORFF'S ALPHA ABOVE
 * `krippendorffAlphaOrdinal` already covers multi-rater agreement with an
 * ordinal distance function and tolerates missing raters per unit, and is the
 * statistically stronger choice for this rubric's ordered 0-4 levels. Fleiss'
 * kappa is added because the CEO-ratified report
 * (reading-room/eval-metrics-verification-2026-08-07.html, citing Wang et al.
 * 2024 and Panickssery/Bowman/Feng 2024) names "Cohen's or Fleiss' kappa"
 * explicitly as the expected reliability figure for a cross-family judge
 * panel, so both are reported rather than substituting one the report did not
 * name. Unlike alpha, standard Fleiss' kappa requires every unit to have the
 * SAME number of raters; units with a different rater count are dropped
 * (not silently coerced), and the count is surfaced in the result so a caller
 * can tell whether that pruning discarded anything.
 *
 * `ratings` is one array of category codes per unit (one entry per rater).
 * Categories must be integers in [minCat, maxCat].
 */
export function fleissKappa(ratings: number[][], minCat: number, maxCat: number): StatWithReason {
  const k = maxCat - minCat + 1;
  if (k < 2) return { value: null, undefinedReason: "fewer than 2 categories", n: 0 };

  const nPerUnit = ratings.length > 0 ? ratings[0].length : 0;
  const usable = ratings.filter((u) => u.length === nPerUnit && u.length >= 2);
  const N = usable.length;
  if (N === 0) {
    return {
      value: null,
      undefinedReason: "no unit has the modal rater count with >= 2 raters (Fleiss requires a fixed rater count per unit)",
      n: 0,
    };
  }
  const n = nPerUnit;

  // n_ij: count of raters assigning unit i to category j.
  const counts = usable.map((u) => {
    const row = new Array<number>(k).fill(0);
    for (const v of u) row[v - minCat] += 1;
    return row;
  });

  let PbarSum = 0;
  for (const row of counts) {
    let sumSq = 0;
    for (const c of row) sumSq += c * c;
    PbarSum += (sumSq - n) / (n * (n - 1));
  }
  const Pbar = PbarSum / N;

  const pj = new Array<number>(k).fill(0);
  for (const row of counts) for (let j = 0; j < k; j++) pj[j] += row[j];
  for (let j = 0; j < k; j++) pj[j] /= N * n;
  const PeBar = pj.reduce((s, p) => s + p * p, 0);

  if (PeBar === 1) {
    return { value: null, undefinedReason: "expected chance agreement is 1 (degenerate category marginals)", n: N };
  }
  return { value: (Pbar - PeBar) / (1 - PeBar), n: N };
}

// ---------------------------------------------------------------------------
// Krippendorff's alpha, ordinal metric
// ---------------------------------------------------------------------------

/**
 * Krippendorff's alpha with the ORDINAL difference function, for any number of
 * raters and missing values.
 *
 * `units` is one array of observed values per unit; a unit contributes only if
 * it has at least 2 observations. Values must be integers within [minCat,maxCat].
 *
 * The ordinal difference between ranks c and k uses the marginal frequencies of
 * the coincidence matrix:
 *   delta^2(c,k) = ( sum_{g=c..k} n_g  -  (n_c + n_k)/2 )^2
 * which is why alpha-ordinal depends on the observed distribution and is not a
 * fixed function of the category distance.
 */
export function krippendorffAlphaOrdinal(units: number[][], minCat: number, maxCat: number): StatWithReason {
  const k = maxCat - minCat + 1;
  const usable = units.filter((u) => u.length >= 2);
  const nUnits = usable.length;
  if (nUnits === 0) return { value: null, undefinedReason: "no unit has 2 or more observations", n: 0 };

  // Coincidence matrix.
  const o = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (const u of usable) {
    const m = u.length;
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        if (i === j) continue;
        o[u[i] - minCat][u[j] - minCat] += 1 / (m - 1);
      }
    }
  }

  const nc = new Array<number>(k).fill(0);
  for (let c = 0; c < k; c++) for (let kk = 0; kk < k; kk++) nc[c] += o[c][kk];
  const nTotal = nc.reduce((a, b) => a + b, 0);
  if (nTotal < 2) return { value: null, undefinedReason: "fewer than 2 pairable values", n: nUnits };

  const delta2 = (c: number, kk: number): number => {
    if (c === kk) return 0;
    const lo = Math.min(c, kk);
    const hi = Math.max(c, kk);
    let s = 0;
    for (let g = lo; g <= hi; g++) s += nc[g];
    s -= (nc[lo] + nc[hi]) / 2;
    return s * s;
  };

  let Do = 0;
  for (let c = 0; c < k; c++) for (let kk = 0; kk < k; kk++) Do += o[c][kk] * delta2(c, kk);
  Do /= nTotal;

  let De = 0;
  for (let c = 0; c < k; c++) for (let kk = 0; kk < k; kk++) De += nc[c] * nc[kk] * delta2(c, kk);
  De /= nTotal * (nTotal - 1);

  if (De === 0) {
    return {
      value: null,
      undefinedReason: "expected disagreement is zero (every observation shares one category)",
      n: nUnits,
    };
  }
  return { value: 1 - Do / De, n: nUnits };
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BootstrapCI {
  point: Maybe;
  lower: Maybe;
  upper: Maybe;
  /** Replicates that produced a defined value; the CI is computed over these. */
  usableReplicates: number;
  replicates: number;
  note?: string;
}

/**
 * Percentile bootstrap over UNITS (items), which is the resampling unit that
 * respects the study's dependence structure: replicate ratings of the same item
 * are not independent of each other.
 */
export function bootstrapCI<T>(
  units: T[],
  estimator: (sample: T[]) => Maybe,
  opts: { replicates?: number; seed?: number; alpha?: number } = {},
): BootstrapCI {
  const B = opts.replicates ?? 2000;
  const alpha = opts.alpha ?? 0.05;
  const rand = mulberry32(opts.seed ?? 20260731);
  const point = estimator(units);
  const vals: number[] = [];
  for (let b = 0; b < B; b++) {
    const sample: T[] = new Array(units.length);
    for (let i = 0; i < units.length; i++) sample[i] = units[Math.floor(rand() * units.length)];
    const v = estimator(sample);
    if (v !== null && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length < Math.max(50, B * 0.1)) {
    return {
      point,
      lower: null,
      upper: null,
      usableReplicates: vals.length,
      replicates: B,
      note: "too few bootstrap replicates produced a defined statistic for a trustworthy interval",
    };
  }
  vals.sort((a, b) => a - b);
  const lo = vals[Math.max(0, Math.floor((alpha / 2) * vals.length))];
  const hi = vals[Math.min(vals.length - 1, Math.ceil((1 - alpha / 2) * vals.length) - 1)];
  return { point, lower: lo, upper: hi, usableReplicates: vals.length, replicates: B };
}

// ---------------------------------------------------------------------------
// Descriptives
// ---------------------------------------------------------------------------

export function mean(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}
export function sd(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
}
export function median(a: number[]): number {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Landis & Koch (1977) benchmark labels. Included because the thesis cites
 * kappa bands, but they are a convention, not a significance test, and the
 * write-up says so.
 */
/**
 * Krippendorff's own reliability thresholds. These are NOT the Landis & Koch
 * kappa bands and must not be swapped for them: alpha 0.65 is "not adequate"
 * under Krippendorff while 0.65 reads as "substantial" under Landis & Koch,
 * which would turn an inadequate dimension into a reassuring word.
 */
export function alphaBand(a: Maybe): string {
  if (a === null) return "undefined";
  if (a < 0.667) return "BELOW 0.667 - not adequate";
  if (a < 0.8) return "0.667-0.80 - tentative conclusions only";
  return ">=0.80 - adequate";
}

export function agreementBand(k: Maybe): string {
  if (k === null) return "undefined";
  if (k < 0) return "worse than chance";
  if (k <= 0.2) return "slight";
  if (k <= 0.4) return "fair";
  if (k <= 0.6) return "moderate";
  if (k <= 0.8) return "substantial";
  return "almost perfect";
}
