import type { Decision } from "@prisma/client";
import type { RubricScores } from "@/lib/services/types";

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
 * Derive the authoritative decision from rubric scores and the attempt
 * number. `attempt` is 1-based; once MAX_ATTEMPTS_BEFORE_ADJUST is reached,
 * a still-failing checkpoint escalates to adjust_plan instead of repeating.
 *
 * Spec gap (documented decision): §8 defines advance and repeat but is
 * silent on the middle band (all dims >=2, fewer than four >=3). We treat
 * that as "not yet earned": repeat while attempts remain, then advance once
 * the cap is hit, so a proficient learner isn't ground down.
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
