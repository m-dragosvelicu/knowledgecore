/**
 * L1 Slice 2 — the Path Confirmation clarifying dialogue contract.
 *
 * This is the SAME turn-taking primitive as the Goal Interview, instantiated in a
 * new context (one engine, three contexts: Goal Interview, Path Confirmation,
 * Checkpoint remediation). It deliberately reuses `InterviewTurn` / a step shape
 * isomorphic to `InterviewStep` from the LOCKED `lib/services/types.ts` so the
 * client turn-loop (the existing OutcomeClient pattern) drives it unchanged: the
 * client holds the running transcript and re-sends it each turn; the service is
 * stateless.
 *
 * What is NEW here is only the CONTEXT, not the mechanic:
 *   - the system asks clarifying questions about what is OFF in the proposed path
 *     overview (Call A), rather than what success looks like.
 *   - on completion it returns a concise, structured CONCERN SUMMARY that is fed
 *     straight into the EXISTING Path Adjuster (`adjust_plan`) to revise the
 *     overview. We do NOT add new path-revision logic.
 *
 * This contract is ADDITIVE — it does not touch the LOCKED `lib/services/types.ts`
 * interface boundary. It lives alongside it and is wired through the service
 * registry like `getLessonContentGenerator()`.
 */

import type { CanDoStatement, InterviewTurn } from "@/lib/services/types";

/** A goalpost as shown in the structure-only overview the learner is confirming. */
export type OverviewGoalpost = {
  order: number;
  title: string;
  objective: string;
  estimatedMinutes: number;
};

/** What one clarifying-dialogue turn needs. Stateless: the transcript is re-sent. */
export type PathConfirmationInput = {
  subject: { canonicalName: string; scopeNote: string };
  /** The end "you'll be able to..." achievement the path builds toward (Call A). */
  outcome: CanDoStatement[];
  /** The current (possibly already-revised) structure-only overview. */
  overview: OverviewGoalpost[];
  /** The clarifying conversation so far (assistant questions + learner answers). */
  transcript: InterviewTurn[];
};

/**
 * One step of the clarifying dialogue. Isomorphic to `InterviewStep` (same
 * "question | complete" turn-taking primitive) but the terminal payload carries a
 * CONCERN SUMMARY destined for the Path Adjuster instead of can-do statements.
 *   - kind="question": ask ONE focused clarifying question.
 *   - kind="complete": enough is understood; `concern` summarizes, in the
 *     learner's terms, what is off so the Path Adjuster can revise the overview.
 */
export type PathConfirmationStep =
  | { kind: "question"; question: string }
  | { kind: "complete"; concern: string };

export interface PathConfirmationInterviewer {
  /**
   * Given the subject, the end achievement, the proposed overview, and the
   * transcript so far, return the next step. Terminates with kind="complete"
   * once the concern is clear enough to revise the path (capped at a few
   * questions so the dialogue stays short).
   */
  clarify(input: PathConfirmationInput): Promise<PathConfirmationStep>;
}
