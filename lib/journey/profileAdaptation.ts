/**
 * L1 Slice 1 — the GENERATION-FIRST adaptation layer (pure).
 *
 * WHAT THIS IS
 * ------------
 * Two pure functions that sit between the persisted `LearnerProfileState`
 * (lib/journey/learnerProfile.ts) and the content-generation prompt (Call B):
 *
 *   1. `deriveSupportPlan(profile, conceptKey)` — the ONE VISIBLE ADAPTATION.
 *      It maps the learner's per-concept mastery (plus a thin-signal guard) onto
 *      a concrete generation directive: how many worked examples to author and a
 *      `supportLevel` (minimal | standard | extended). Low mastery yields MORE
 *      worked examples and a higher support level; high mastery yields fewer and
 *      a lower one. This is the substance knob, computed deterministically in
 *      code (NOT read off a model opinion), then injected into the prompt.
 *
 *   2. `serializeProfileForGeneration(profile, conceptKey)` — renders the profile
 *      (mastery numbers + signal vector + derived band + the derived support plan)
 *      into a PLAIN-TEXT block, in the same style the Path Outliner already uses
 *      for motivation/competencies. No new infra, no new vendor: it is text the
 *      Call B prompt appends to its existing typed-field block.
 *
 * DESIGN PRINCIPLES (from CEO/L1-plan.html)
 * -----------------------------------------
 * - supportLevel naming (NOT "scaffolding").
 * - Productive struggle is the DEFAULT. Support is ADDED on poor performance,
 *   never removed on a learner's request. There is no learner-facing override.
 * - CONSERVATIVE EARLY: with thin evidence (few observations) the plan stays near
 *   standard and does not over-react to a single data point; it ramps as evidence
 *   accumulates. Performance (mastery) wins over self-report.
 * - This module is pure (no Prisma / LLM / DB), so it is trivially unit-testable
 *   (scripts/verify-adaptation.ts).
 */

import type { ConceptMastery, LearnerProfileState } from "./learnerProfile";
import { INITIAL_MASTERY } from "./learnerProfile";

/** Support level surfaced to generation. Mirrors the presenter seam's naming. */
export type SupportLevel = "minimal" | "standard" | "extended";

/**
 * The concrete, generation-facing directive derived from a concept's mastery.
 * The generator is instructed to honour these numbers, so a low-mastery profile
 * produces observably more worked examples / more support than a high-mastery one.
 */
export interface SupportPlan {
  /** How much supporting framing the lesson should carry. */
  supportLevel: SupportLevel;
  /** Minimum number of fully worked examples the information step must include. */
  workedExamples: number;
  /** The mastery estimate the plan was derived from (for the prompt + audit). */
  mastery: number;
  /** Evidence count behind that estimate (drives the conservative-early guard). */
  observations: number;
  /** Whether the signal is still THIN (few observations) — plan stays conservative. */
  thinSignal: boolean;
  /** One-line human-readable explanation (for the prompt + telemetry/audit). */
  reason: string;
}

// ---------------------------------------------------------------------------
// Tuning constants (fixed, documented — like the BKT params, these are CHOSEN
// rules, not fitted values).
// ---------------------------------------------------------------------------

/**
 * Below this much evidence the plan is in its CONSERVATIVE-EARLY regime: it
 * nudges toward more support (never less) and never awards the leanest plan, so
 * a single lucky/unlucky answer cannot strip support away or pile it on.
 */
export const THIN_SIGNAL_OBSERVATIONS = 2;

/** Mastery at/below this is LOW → maximum support. */
export const LOW_MASTERY_MAX = 0.4;
/** Mastery at/above this is HIGH → minimum support. */
export const HIGH_MASTERY_MIN = 0.7;

/** Worked-example counts per band. Low gets the MOST; high the FEWEST. */
export const WORKED_EXAMPLES_LOW = 3;
export const WORKED_EXAMPLES_MID = 2;
export const WORKED_EXAMPLES_HIGH = 1;

/**
 * Look up a concept's mastery state, treating an unseen concept as the fixed
 * prior with zero observations (the genuinely-thin case).
 */
function masteryFor(
  profile: LearnerProfileState | null | undefined,
  conceptKey: string,
): ConceptMastery {
  const existing = profile?.conceptMastery?.[conceptKey];
  if (existing) return existing;
  return { mastery: INITIAL_MASTERY, observations: 0, lastUpdatedAt: "" };
}

/**
 * THE ONE VISIBLE ADAPTATION (CEO/L1-checklist Slice 1).
 *
 * Map a concept's mastery onto a worked-example count + supportLevel:
 *   - LOW mastery (<= LOW_MASTERY_MAX)  -> extended support, MOST worked examples
 *   - HIGH mastery (>= HIGH_MASTERY_MIN) -> minimal support, FEWEST worked examples
 *   - MID                                -> standard support, middle count
 *
 * CONSERVATIVE-EARLY guard: while the signal is thin (observations <
 * THIN_SIGNAL_OBSERVATIONS) we never award the leanest (high-mastery) plan — a
 * not-yet-earned "you clearly know this" would be the costly mistake. We default
 * to at least standard support so productive struggle is preserved but the
 * learner is not under-supported on a single data point.
 */
export function deriveSupportPlan(
  profile: LearnerProfileState | null | undefined,
  conceptKey: string,
): SupportPlan {
  const { mastery, observations } = masteryFor(profile, conceptKey);
  const thinSignal = observations < THIN_SIGNAL_OBSERVATIONS;

  let supportLevel: SupportLevel;
  let workedExamples: number;

  if (mastery <= LOW_MASTERY_MAX) {
    supportLevel = "extended";
    workedExamples = WORKED_EXAMPLES_LOW;
  } else if (mastery >= HIGH_MASTERY_MIN) {
    supportLevel = "minimal";
    workedExamples = WORKED_EXAMPLES_HIGH;
  } else {
    supportLevel = "standard";
    workedExamples = WORKED_EXAMPLES_MID;
  }

  // Conservative-early: do not award the leanest plan on thin evidence. Floor a
  // thin "minimal" up to "standard" so support is never prematurely withdrawn.
  let reason: string;
  if (thinSignal && supportLevel === "minimal") {
    supportLevel = "standard";
    workedExamples = WORKED_EXAMPLES_MID;
    reason =
      `mastery ${mastery.toFixed(2)} looks high but evidence is still thin ` +
      `(${observations} obs); holding at standard support until it is earned`;
  } else if (mastery <= LOW_MASTERY_MAX) {
    reason =
      `low mastery (${mastery.toFixed(2)}) → extended support and ` +
      `${workedExamples} worked examples to build the idea up carefully`;
  } else if (mastery >= HIGH_MASTERY_MIN) {
    reason =
      `high mastery (${mastery.toFixed(2)}) → minimal support and a single ` +
      `worked example; keep it lean and let the learner do the work`;
  } else {
    reason =
      `mid mastery (${mastery.toFixed(2)}) → standard support and ` +
      `${workedExamples} worked examples`;
  }

  return { supportLevel, workedExamples, mastery, observations, thinSignal, reason };
}

/**
 * Render the profile into a PLAIN-TEXT block for the Call B generation prompt,
 * mirroring how livePathOutliner formats motivation/competencies. This is the
 * core of L1: the profile is injected into CONTENT GENERATION, not just render.
 *
 * The block names the derived support plan explicitly so the generator has an
 * unambiguous instruction (number of worked examples + support level), with the
 * mastery numbers and signal vector as the supporting context. An absent/empty
 * profile degrades to the conservative cold-start text.
 */
export function serializeProfileForGeneration(
  profile: LearnerProfileState | null | undefined,
  conceptKey: string,
): string {
  const plan = deriveSupportPlan(profile, conceptKey);
  const lines: string[] = [];

  lines.push(`LEARNER PROFILE (adapt the lesson to THIS learner):`);

  // Per-concept mastery — this goalpost's concept first, then any others.
  const masteryMap = profile?.conceptMastery ?? {};
  const thisConcept = masteryMap[conceptKey];
  if (thisConcept) {
    lines.push(
      `- This goalpost's concept ("${conceptKey}"): estimated mastery ` +
        `${thisConcept.mastery.toFixed(2)} from ${thisConcept.observations} ` +
        `observation(s).`,
    );
  } else {
    lines.push(
      `- This goalpost's concept ("${conceptKey}"): no evidence yet ` +
        `(cold start; assume a motivated learner, do not over-explain).`,
    );
  }
  const others = Object.entries(masteryMap).filter(([k]) => k !== conceptKey);
  if (others.length) {
    lines.push(`- Mastery on related concepts so far:`);
    for (const [k, v] of others) {
      lines.push(`  - ${k}: ${v.mastery.toFixed(2)} (${v.observations} obs)`);
    }
  }

  const s = profile?.signals;
  if (s) {
    const effort =
      s.latestPaasEffort == null ? "not yet rated" : `${s.latestPaasEffort}/9`;
    lines.push(
      `- Effort/struggle signals: latest perceived effort ${effort}; ` +
        `${s.totalRetries} repeat attempt(s) so far across the journey; ` +
        `${Math.round(s.totalTimeOnTaskMs / 1000)}s total time-on-task; ` +
        `${s.visualNotHelpfulCount} visual(s) flagged not-helpful.`,
    );
  }

  const band = profile?.derivedSignals?.expertiseBand;
  if (band) lines.push(`- Inferred expertise band: ${band}.`);

  // THE DIRECTIVE — the visible adaptation, stated as an instruction.
  lines.push(``);
  lines.push(`ADAPTATION DIRECTIVE for this lesson (derived from the profile):`);
  lines.push(
    `- Support level: ${plan.supportLevel.toUpperCase()}. Productive struggle ` +
      `is the default; ADD support only as performance shows it is needed, ` +
      `never strip it away to "move faster".`,
  );
  lines.push(
    `- Include AT LEAST ${plan.workedExamples} fully worked example(s) in the ` +
      `information step.`,
  );
  if (plan.supportLevel === "extended") {
    lines.push(
      `- Because mastery is low, go slower: define terms before using them, ` +
        `break the idea into smaller steps, and add a short "common mistake" note.`,
    );
  } else if (plan.supportLevel === "minimal") {
    lines.push(
      `- Because mastery is high, keep it lean: skip basics the learner has ` +
        `shown they know, move quickly, and lean on the experience step for depth.`,
    );
  }
  lines.push(`- Rationale (internal, do not echo to the learner): ${plan.reason}.`);

  return lines.join("\n");
}
