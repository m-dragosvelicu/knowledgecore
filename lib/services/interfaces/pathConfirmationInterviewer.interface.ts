import type {
  PathConfirmationInput,
  PathConfirmationStep,
} from "@/lib/services/pathConfirmation";

export interface PathConfirmationInterviewer {
  /**
   * Given the subject, the end achievement, the proposed overview, and the
   * transcript so far, return the next step. Terminates with kind="complete"
   * once the concern is clear enough to revise the path (capped at a few
   * questions so the dialogue stays short).
   */
  clarify(input: PathConfirmationInput): Promise<PathConfirmationStep>;
}
