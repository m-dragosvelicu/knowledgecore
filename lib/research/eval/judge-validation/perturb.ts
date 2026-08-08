/**
 * Deterministic perturbation battery.
 *
 * WHY DETERMINISTIC
 * The perturbation test is a directional-validity check: a degraded artifact
 * MUST NOT score higher than the artifact it was degraded from. For that test
 * to be evidence rather than anecdote, the degradation has to be reproducible
 * and independent of any model. Every transform here is a pure function of the
 * input string plus a fixed seed, so the whole battery regenerates identically
 * on any machine and no LLM is in the loop producing the "worse" version.
 *
 * Each perturbation targets rubric dimensions it should predictably damage.
 * The strong claim under test is only the global one (total score must drop);
 * the per-dimension expectations are reported as a secondary, weaker signal
 * because a rubric dimension can legitimately be insensitive to a given edit.
 */

export type PerturbationId =
  | "trunc40"
  | "shuffle"
  | "term_corrupt"
  | "topic_splice"
  | "despecify";

export interface PerturbationSpec {
  id: PerturbationId;
  label: string;
  /** What the degradation removes, in plain language, for the write-up. */
  rationale: string;
  /** Dimensions this edit is predicted to damage most. Secondary signal only. */
  expectedDimensions: string[];
}

export const PERTURBATIONS: PerturbationSpec[] = [
  {
    id: "trunc40",
    label: "Truncation to first 40 percent",
    rationale:
      "Keeps only the opening 40 percent of sentences. The artifact stops mid-argument, so the objective is left partly unaddressed and any transfer or boundary discussion is lost.",
    expectedDimensions: ["coverage", "transfer", "communication"],
  },
  {
    id: "shuffle",
    label: "Seeded sentence shuffle",
    rationale:
      "Reorders sentences with a fixed seed. Every fact survives; only the ordering that carries the argument is destroyed, isolating whether the judge scores structure at all or just keyword presence.",
    expectedDimensions: ["communication", "conceptual"],
  },
  {
    id: "term_corrupt",
    label: "Domain-term corruption",
    rationale:
      "Swaps correct domain terms for plausible but wrong ones via a per-scenario map. Fluency and structure are untouched, so this isolates whether the judge detects factual error under confident prose.",
    expectedDimensions: ["recall", "conceptual", "application"],
  },
  {
    id: "topic_splice",
    label: "Off-topic splice",
    rationale:
      "Replaces the back half with the back half of a different scenario's mastery artifact. The result is fluent, detailed and largely irrelevant to the stated objective.",
    expectedDimensions: ["coverage", "transfer"],
  },
  {
    id: "despecify",
    label: "Specificity strip",
    rationale:
      "Removes named entities, numbers and technical specifics listed for the scenario, replacing them with vague fillers. Claim structure survives; the evidence backing it does not.",
    expectedDimensions: ["recall", "application", "conceptual"],
  },
];

/** Split into sentences while keeping terminal punctuation attached. */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g);
  return (parts ?? [text]).map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Mulberry32: a small, fully specified PRNG. Using a named algorithm rather
 * than Math.random is what makes the shuffle reproducible from the seed alone.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates with a seeded PRNG. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const SHUFFLE_SEED = 20260731;

export function truncate40(text: string): string {
  const sentences = splitSentences(text);
  const keep = Math.max(1, Math.floor(sentences.length * 0.4));
  return sentences.slice(0, keep).join(" ");
}

export function shuffleSentences(text: string): string {
  const sentences = splitSentences(text);
  return seededShuffle(sentences, SHUFFLE_SEED).join(" ");
}

/**
 * Case-preserving whole-word-ish replacement. Longest keys first so a longer
 * phrase is not partially clobbered by a shorter overlapping key.
 */
export function corruptTerms(text: string, swaps: Array<[string, string]>): string {
  const ordered = swaps.slice().sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [from, to] of ordered) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Word boundaries only where the term starts/ends with a word character;
    // terms like "O(log n)" or "NADP+" would never match with a hard \b.
    const lead = /^\w/.test(from) ? "\\b" : "";
    const tail = /\w$/.test(from) ? "\\b" : "";
    const re = new RegExp(`${lead}${escaped}${tail}`, "gi");
    out = out.replace(re, (match) => {
      if (match === match.toUpperCase() && match.length > 1) return to.toUpperCase();
      if (/^[A-Z]/.test(match)) return to.charAt(0).toUpperCase() + to.slice(1);
      return to;
    });
  }
  return out;
}

/** Replace the back half of `text` with the back half of `donor`. */
export function spliceOffTopic(text: string, donor: string): string {
  const own = splitSentences(text);
  const other = splitSentences(donor);
  const keep = Math.max(1, Math.floor(own.length / 2));
  const take = Math.max(1, Math.floor(other.length / 2));
  return [...own.slice(0, keep), ...other.slice(other.length - take)].join(" ");
}

const VAGUE_FILLERS = [
  "a certain thing",
  "one of the relevant components",
  "the usual sort of value",
  "something along those lines",
  "a particular case",
];

/**
 * Strip listed specifics and vague-ify residual numerics. Filler choice cycles
 * deterministically by index so repeated runs produce byte-identical output.
 */
export function despecify(text: string, specifics: string[]): string {
  const ordered = specifics.slice().sort((a, b) => b.length - a.length);
  let out = text;
  ordered.forEach((s, i) => {
    const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), VAGUE_FILLERS[i % VAGUE_FILLERS.length]);
  });
  // Residual standalone numbers (years, counts, quantities) go vague too.
  out = out.replace(/\b\d[\d,.]*\b/g, "some number");
  return out;
}

export interface PerturbedItem {
  perturbation: PerturbationId;
  text: string;
}

/**
 * Build the full battery for one scenario's mastery artifact.
 * `donorText` supplies the off-topic splice and must come from a DIFFERENT
 * scenario, otherwise the splice is not off-topic.
 */
export function buildBattery(args: {
  masteryText: string;
  termSwaps: Array<[string, string]>;
  specifics: string[];
  donorText: string;
}): PerturbedItem[] {
  return [
    { perturbation: "trunc40", text: truncate40(args.masteryText) },
    { perturbation: "shuffle", text: shuffleSentences(args.masteryText) },
    { perturbation: "term_corrupt", text: corruptTerms(args.masteryText, args.termSwaps) },
    { perturbation: "topic_splice", text: spliceOffTopic(args.masteryText, args.donorText) },
    { perturbation: "despecify", text: despecify(args.masteryText, args.specifics) },
  ];
}
