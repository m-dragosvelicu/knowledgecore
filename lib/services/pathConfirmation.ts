/**
 * Path Confirmation clarifying dialogue data types. Same turn-taking primitive
 * as the Goal Interview (`InterviewTurn` / an `InterviewStep`-isomorphic step),
 * reused across three contexts so the client's stateless turn-loop drives it
 * unchanged. Asks what is off in the proposed overview and returns a concern
 * summary fed to the existing Path Adjuster. Additive — does not touch the
 * locked `lib/services/types.ts` boundary. The `PathConfirmationInterviewer`
 * interface itself lives in
 * `lib/services/interfaces/pathConfirmationInterviewer.interface.ts`.
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
 * question|complete turn-taking) but the terminal payload carries a concern
 * summary for the Path Adjuster instead of can-do statements.
 *   - kind="question": ask one focused clarifying question.
 *   - kind="complete": `concern` summarizes what is off, in the learner's terms.
 */
export type PathConfirmationStep =
  | { kind: "question"; question: string }
  | { kind: "complete"; concern: string };
