/**
 * L1 Slice 1 — the Call B contract (lazy per-goalpost lesson-content generation).
 *
 * The L0 PathOutliner generates the whole path (structure AND information content)
 * up front in one call. L1 splits this:
 *
 *   - Call A = the existing PathOutliner: structure (titles, objectives, the
 *     experience task, estimated minutes). Built up front from journey context.
 *   - Call B = THIS service: the information-step content for ONE goalpost,
 *     generated WHEN THE LEARNER ENTERS IT, with the learner profile injected so
 *     the substance is tailored (more/fewer worked examples, support level).
 *
 * This contract is ADDITIVE — it does not touch the LOCKED `lib/services/types.ts`
 * interface boundary. It lives alongside it and is wired through `getServices()`
 * like the other services.
 */

import type { LearnerProfileState } from "@/lib/journey/learnerProfile";
import type { Competency } from "@/lib/services/types";

/** What Call B needs to author the information content for one goalpost. */
export type LessonContentInput = {
  /** Stable concept key for this goalpost (the goalpost id). Drives adaptation. */
  conceptKey: string;
  /** Subject for context. */
  subject: { canonicalName: string; scopeNote: string };
  /** This goalpost's structure (from Call A). */
  goalpost: { order: number; title: string; objective: string };
  /** The experience prompt the learner will face after reading (for alignment). */
  experiencePrompt: string;
  /** The closing achievement / success criterion of the whole path (Call A). */
  endAchievement: string;
  /** Assessed competencies, for cold-start context before mastery accrues. */
  assessment: Competency[];
  /**
   * The journey learner profile. May be a cold-start (empty) profile; the
   * serializer degrades gracefully. This is the core of L1: it is injected into
   * the generation prompt so low mastery yields more worked examples.
   */
  profile: LearnerProfileState | null;
};

export type LessonContent = {
  /** Markdown information content for the goalpost's information step. */
  content: string;
  /** The supportLevel the content was authored at (audit / telemetry). */
  supportLevel: "minimal" | "standard" | "extended";
  /** The number of worked examples requested (audit / telemetry). */
  workedExamples: number;
};

export interface LessonContentGenerator {
  generate(input: LessonContentInput): Promise<LessonContent>;
}
