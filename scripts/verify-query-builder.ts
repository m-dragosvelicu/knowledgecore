/**
 * fix/tavily-query-length verification: query construction stays under the
 * Tavily 400-char cap and never emits a mid-word cut.
 * Run: bun run scripts/verify-query-builder.ts
 *
 * No network/DB required.
 */

import { buildSearchQuery, clampQuery, DEFAULT_MAX_QUERY_LENGTH } from "../lib/research/queryBuilder";

let ok = 0;
let fail = 0;

function check(name: string, pass: boolean, detail = ""): void {
  // eslint-disable-next-line no-console
  console.log(`${pass ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
  pass ? ok++ : fail++;
}

function endsMidWord(fullSource: string, query: string): boolean {
  // A mid-word cut means the char immediately after the query, in the
  // source text it was cut from, is itself a non-space (i.e. we stopped
  // partway through a word rather than at a boundary).
  const cutIndex = query.length;
  if (cutIndex >= fullSource.length) return false;
  const lastCharOfQuery = query[query.length - 1];
  const nextChar = fullSource[cutIndex];
  return lastCharOfQuery !== " " && nextChar !== " " && nextChar !== undefined;
}

// ---------------------------------------------------------------------------
// (A) Short input: passes through untouched.
// ---------------------------------------------------------------------------

const shortLabel = "Lean Manufacturing";
const shortObjectives = ["what is lean manufacturing", "key principles and examples"];
const shortResult = buildSearchQuery(shortLabel, shortObjectives);
check(
  "short input passes through unchanged",
  shortResult === `${shortLabel} ${shortObjectives.join(" ")}`,
  shortResult,
);
check("short input under cap", shortResult.length <= DEFAULT_MAX_QUERY_LENGTH, `${shortResult.length} chars`);

// ---------------------------------------------------------------------------
// (B) Long goalpost list (the real-world failure case): must stay <= 400.
// ---------------------------------------------------------------------------

const longObjectives = [
  "understand the fundamental principles of thermodynamics including the zeroth first second and third laws",
  "apply the concept of entropy to real-world engineering systems such as heat engines and refrigerators",
  "analyze phase transitions and equilibrium states using free energy functions and chemical potential",
  "evaluate the efficiency of Carnot cycles versus real irreversible thermodynamic processes",
  "explore statistical mechanics foundations connecting microscopic states to macroscopic thermodynamic quantities",
  "investigate the role of thermodynamics in modern renewable energy systems and sustainability",
];
const longInputLength =
  "Thermodynamics".length + 1 + longObjectives.join(" ").length;
const longResult = buildSearchQuery("Thermodynamics", longObjectives);

check(
  "long goalpost list input actually exceeds the cap (sanity check on the fixture)",
  longInputLength > DEFAULT_MAX_QUERY_LENGTH,
  `${longInputLength} chars raw`,
);
check(
  "long goalpost list is clamped to <= 400 chars",
  longResult.length <= DEFAULT_MAX_QUERY_LENGTH,
  `${longResult.length} chars`,
);
check("long result starts with the topic label", longResult.startsWith("Thermodynamics"));
check("long result is non-empty", longResult.length > 0);
check(
  "long result never cuts mid-word",
  !endsMidWord(`Thermodynamics ${longObjectives.join(" ")}`, longResult),
  `tail="...${longResult.slice(-30)}"`,
);
check("long result has no trailing whitespace", longResult === longResult.trim());

// ---------------------------------------------------------------------------
// (C) Topic label alone longer than the cap.
// ---------------------------------------------------------------------------

const hugeLabelWords = Array.from({ length: 80 }, (_, i) => `word${i}`);
const hugeLabel = hugeLabelWords.join(" "); // ~470 chars
const hugeLabelResult = buildSearchQuery(hugeLabel, ["short objective"]);
check("huge label alone is clamped to <= 400 chars", hugeLabelResult.length <= DEFAULT_MAX_QUERY_LENGTH, `${hugeLabelResult.length} chars`);
check(
  "huge label result never cuts mid-word",
  !endsMidWord(hugeLabel, hugeLabelResult),
  `tail="...${hugeLabelResult.slice(-20)}"`,
);

// ---------------------------------------------------------------------------
// (D) No goalpost objectives: falls back to just the label.
// ---------------------------------------------------------------------------

const noObjectivesResult = buildSearchQuery("Art Nouveau", []);
check("no objectives -> topic label only", noObjectivesResult === "Art Nouveau", noObjectivesResult);

// ---------------------------------------------------------------------------
// (E) clampQuery backstop.
// ---------------------------------------------------------------------------

const alreadySafe = clampQuery("a short query", "test-client");
check("clampQuery is a no-op under the cap", alreadySafe === "a short query", alreadySafe);

const overLong = "x".repeat(500) + " tail";
const clamped = clampQuery(overLong, "test-client");
check("clampQuery clamps an over-long query", clamped.length <= DEFAULT_MAX_QUERY_LENGTH, `${clamped.length} chars`);

// eslint-disable-next-line no-console
console.log(`\n${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
