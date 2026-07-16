/**
 * Outcome revision — founder ruling 2026-07-16: on the outcome review screen,
 * before the knowledge probe, a learner who feels the synthesized outcome missed
 * what they wanted must be able to say so in free text and get a revised outcome.
 *
 * NOT the shared dialogue engine's third context. The Goal Interview and Path
 * Confirmation contexts (`GoalInterviewer`, `PathConfirmationInterviewer`) share a
 * turn-taking "question | complete" primitive: the MODEL decides, turn by turn,
 * whether it needs to ask another clarifying question before it has enough to
 * act. Outcome revision has no such ambiguity to resolve — the learner has
 * already stated their objection in one message, and the correct response is a
 * single structured rewrite plus an acknowledgment. Forcing this into the
 * question/complete shape would mean either the model manufactures clarifying
 * questions it doesn't need, or every call trivially completes on turn one,
 * making the shared shape pure overhead. This is architecturally the same shape
 * as `PathAdjuster` (single input, single structured output, no model-decided
 * turn-taking) and is modeled on it. "Back-and-forth" here means the learner can
 * call `revise` again on the just-revised outcome (repeatable single-shot calls),
 * not a multi-turn clarifying conversation.
 *
 * ADDITIVE like `PathConfirmationInterviewer`: does not touch the LOCKED
 * `lib/services/types.ts` Services boundary; wired through its own selector.
 */

import type { CanDoStatement } from "@/lib/services/types";

export type OutcomeSubject = {
  canonicalName: string;
  scopeNote: string;
};

export type OutcomeRevisionInput = {
  subject: OutcomeSubject;
  canDoStatements: CanDoStatement[];
  successCriterion: string;
  /** The learner's free-text objection/adjustment, e.g. "I actually wanted X, not Y." */
  feedback: string;
};

export type OutcomeRevisionResult = {
  subject: OutcomeSubject;
  canDoStatements: CanDoStatement[];
  successCriterion: string;
  /** Short, warm, second-person acknowledgment the UI shows above the revised outcome. */
  acknowledgment: string;
};

export interface OutcomeReviser {
  /**
   * Revise the outcome from one piece of learner feedback. Preserves whatever
   * the feedback did not object to; only the parts it calls out should change.
   */
  revise(input: OutcomeRevisionInput): Promise<OutcomeRevisionResult>;
}
