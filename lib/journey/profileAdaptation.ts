/**
 * L1 Slice 1 — the generation-first adaptation layer (pure). Two functions
 * sit between the persisted `LearnerProfileState` and the content-generation
 * prompt (Call B): `deriveSupportPlan` maps per-concept mastery (plus a
 * thin-signal guard) onto a worked-example count + supportLevel, computed
 * deterministically (not read off a model opinion); `serializeProfileForGeneration`
 * renders the profile + derived plan into the plain-text block Call B's
 * prompt appends to its existing typed-field block.
 *
 * Design (CEO/L1-plan.html): supportLevel naming, not "scaffolding".
 * Productive struggle is the default — support is added on poor performance,
 * never removed on request; no learner-facing override. Conservative early:
 * thin evidence keeps the plan near standard rather than over-reacting to one
 * data point; performance (mastery) wins over self-report. Pure, no
 * Prisma/LLM/DB — unit-tested via scripts/verify-adaptation.ts.
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

// Tuning constants — fixed and documented, like the BKT params, not fitted.

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
 * The one visible adaptation (CEO/L1-checklist Slice 1): maps a concept's
 * mastery onto a worked-example count + supportLevel — low mastery ->
 * extended support/most examples, high -> minimal/fewest, mid -> standard.
 *
 * Conservative-early guard: while observations < THIN_SIGNAL_OBSERVATIONS,
 * never award the leanest (high-mastery) plan — floor to at least standard
 * so a not-yet-earned "you clearly know this" can't strip support on one
 * data point.
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
 * Render the profile into a plain-text block for the Call B generation
 * prompt (mirrors livePathOutliner's motivation/competencies formatting) —
 * the core of L1: the profile is injected into content generation, not just
 * render. Names the derived support plan explicitly as the instruction
 * (worked-example count + support level); mastery numbers and signal vector
 * are supporting context. An absent/empty profile degrades to cold-start text.
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
