/**
 * Call B: lazy per-goalpost lesson-content generation, split from Call A (the
 * PathOutliner, which builds structure up front). Runs when the learner enters
 * the goalpost, with the learner profile injected to tailor support level and
 * worked-example count. Additive — does not touch the locked `types.ts`
 * boundary; wired through `getServices()`. The `LessonContentGenerator`
 * interface itself lives in
 * `lib/services/interfaces/lessonContentGenerator.interface.ts`.
 */

import type { LearnerProfileState } from "@/lib/journey/profile/model";
import type { Competency } from "@/lib/services/types";
import type { VisualNeed } from "@/lib/services/visualMedia";

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
  /**
   * Visual needs emitted for this lesson, each tagged with a `visualKind`
   * that lib/services/visual/gate.ts routes to a concrete medium (SVG | image
   * | video). May be empty — a generator that emits no visuals returns [].
   */
  visuals: VisualNeed[];
};
