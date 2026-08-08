import type {
  OutcomeRevisionInput,
  OutcomeRevisionResult,
} from "@/lib/services/outcomeRevision";

export interface OutcomeReviser {
  /**
   * Revise the outcome from one piece of learner feedback. Preserves whatever
   * the feedback did not object to; only the parts it calls out should change.
   */
  revise(input: OutcomeRevisionInput): Promise<OutcomeRevisionResult>;
}
