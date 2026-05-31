import type { Decision } from "@prisma/client";
import type { RubricScores } from "@/lib/services/types";

// =====================================================================
// Authoritative checkpoint decision (L0.md §8).
//
// The CheckpointEvaluator (LLM-as-judge) returns rubric scores, evidence
// quotes, and a rationale. Its own `decision` field is treated as ADVISORY:
// the authoritative branch is derived here, deterministically, from the
// scores. This (1) fixes the audited spec violation where the model was
// trusted to apply the threshold rule itself, (2) makes the decision
// reproducible and thesis-defensible, and (3) lets us enforce the §9.6
// repeat cap independently of model behaviour.
//
// §8 rule, verbatim: "advance if no dimension < 2 and at least four
// dimensions >= 3; repeat if any dimension < 2; adjust_plan if Coverage
// Mismatch fires (user demonstrates a gap the goalpost did not target)."
// =====================================================================

// §9.6 ("2 repeats then mandatory adjustment, to avoid grinding"): the initial
// submission is attempt 1; two further repeats are attempts 2 and 3. So on the
// 3rd attempt a still-failing checkpoint escalates to adjust_plan rather than
// offering a third repeat.
export const MAX_ATTEMPTS_BEFORE_ADJUST = 3;

const ADVANCE_MIN_LEVEL = 2; // no dimension may sit below "proficient"
const ADVANCE_ADVANCED_LEVEL = 3; // "advanced" or better
const ADVANCE_ADVANCED_COUNT = 4; // at least four dimensions advanced

function dimensionValues(scores: RubricScores): number[] {
  return [
    scores.recall,
    scores.application,
    scores.conceptual,
    scores.transfer,
    scores.communication,
    scores.coverage,
  ] as number[];
}

/**
 * Coverage Mismatch (§8): the learner demonstrates competence on the work
 * itself but the Coverage dimension is low — a signal that the goalpost
 * targeted the wrong thing (the path is wrong, not the learner). When this
 * fires we adjust the plan rather than make the learner repeat.
 */
export function isCoverageMismatch(scores: RubricScores): boolean {
  const nonCoverage: number[] = [
    scores.recall,
    scores.application,
    scores.conceptual,
    scores.transfer,
    scores.communication,
  ];
  const nonCoverageAvg =
    nonCoverage.reduce((a, b) => a + b, 0) / nonCoverage.length;
  return scores.coverage < ADVANCE_MIN_LEVEL && nonCoverageAvg >= ADVANCE_MIN_LEVEL;
}

function meetsAdvanceBar(scores: RubricScores): boolean {
  const dims = dimensionValues(scores);
  const noneBelowProficient = dims.every((d) => d >= ADVANCE_MIN_LEVEL);
  const advancedCount = dims.filter((d) => d >= ADVANCE_ADVANCED_LEVEL).length;
  return noneBelowProficient && advancedCount >= ADVANCE_ADVANCED_COUNT;
}

/**
 * Derive the authoritative decision from rubric scores and the attempt number.
 *
 * `attempt` is 1-based (first submission = 1). The §9.6 cap means: once a
 * learner has used up MAX_ATTEMPTS_BEFORE_ADJUST attempts, a still-failing
 * checkpoint escalates to adjust_plan (the honest escape — see
 * checkpoint_evaluator_design), and a borderline-proficient checkpoint is
 * allowed to advance rather than grind.
 *
 * Spec gap note (documented decision): §8 defines advance (no dim<2 AND >=4
 * dims>=3) and repeat (any dim<2) but is silent on the middle band — all
 * dimensions >=2 yet fewer than four >=3. We treat that band as "passing on
 * a clean run is not yet earned": it repeats while attempts remain, then
 * advances once the cap is hit (avoids grinding a proficient learner).
 */
export function deriveDecision(scores: RubricScores, attempt: number): Decision {
  // Coverage Mismatch takes precedence: the plan is wrong, fix the plan.
  if (isCoverageMismatch(scores)) return "adjust_plan";

  const dims = dimensionValues(scores);
  const anyBelowProficient = dims.some((d) => d < ADVANCE_MIN_LEVEL);
  const capReached = attempt >= MAX_ATTEMPTS_BEFORE_ADJUST;

  if (meetsAdvanceBar(scores)) return "advance";

  if (anyBelowProficient) {
    // Failing checkpoint: repeat until the cap, then escalate to adjust_plan.
    return capReached ? "adjust_plan" : "repeat";
  }

  // Middle band: proficient everywhere but not advanced enough.
  // Repeat to push for mastery while attempts remain; advance once capped.
  return capReached ? "advance" : "repeat";
}
