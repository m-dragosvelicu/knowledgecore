/**
 * Standalone check of the authoritative §8 decision rule (lib/journey/decision.ts).
 * Run: `bun run scripts/verify-decision.ts`. No DB or LLM needed (decision.ts has
 * only type-level imports). Exits non-zero on any failure.
 */
import {
  deriveDecision,
  isCoverageMismatch,
  MAX_ATTEMPTS_BEFORE_ADJUST,
} from "../lib/journey/decision";
import type { RubricScores } from "../lib/services/types";

const S = (
  recall: number,
  application: number,
  conceptual: number,
  transfer: number,
  communication: number,
  coverage: number,
): RubricScores =>
  ({ recall, application, conceptual, transfer, communication, coverage }) as RubricScores;

const cases: [string, RubricScores, number, string][] = [
  ["mastery all 4 -> advance", S(4, 4, 4, 4, 4, 4), 1, "advance"],
  ["strong 3s+ -> advance", S(3, 3, 3, 3, 4, 3), 1, "advance"],
  ["all proficient 2s attempt1 -> repeat (middle band)", S(2, 2, 2, 2, 2, 2), 1, "repeat"],
  ["all proficient 2s attempt3 -> advance (capped)", S(2, 2, 2, 2, 2, 2), 3, "advance"],
  ["one failing dim attempt1 -> repeat", S(1, 3, 3, 3, 3, 3), 1, "repeat"],
  ["one failing dim attempt2 -> repeat", S(1, 3, 3, 3, 3, 3), 2, "repeat"],
  ["one failing dim attempt3 -> adjust_plan (cap)", S(1, 3, 3, 3, 3, 3), 3, "adjust_plan"],
  ["coverage mismatch (cov0, rest strong) -> adjust_plan", S(3, 3, 3, 3, 3, 0), 1, "adjust_plan"],
  ["coverage low but learner weak too -> repeat", S(1, 1, 1, 1, 1, 1), 1, "repeat"],
];

let ok = 0;
let fail = 0;
for (const [name, scores, attempt, want] of cases) {
  const got = deriveDecision(scores, attempt);
  const pass = got === want;
  console.log(`${pass ? "PASS" : "FAIL"} | ${name} | got=${got} want=${want}`);
  pass ? ok++ : fail++;
}

console.log(`\nMAX_ATTEMPTS_BEFORE_ADJUST=${MAX_ATTEMPTS_BEFORE_ADJUST}`);
console.log(`coverage mismatch (strong, cov 0) = ${isCoverageMismatch(S(3, 3, 3, 3, 3, 0))} (want true)`);
console.log(`${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
