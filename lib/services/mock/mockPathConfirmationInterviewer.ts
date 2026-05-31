import type {
  PathConfirmationInput,
  PathConfirmationInterviewer,
  PathConfirmationStep,
} from "@/lib/services/pathConfirmation";

/**
 * Deterministic mock for the Path Confirmation clarifying dialogue. Mirrors
 * MockGoalInterviewer's shape: the step returned is a pure function of how many
 * assistant questions the transcript already holds (the client re-sends the
 * transcript each turn). One canned clarifying question, then completion with a
 * concern summary synthesized from the learner's own words.
 */
const QUESTIONS = [
  "What feels off about this plan — is it aimed at the wrong level, missing something you need, or covering things you already know?",
];

export class MockPathConfirmationInterviewer implements PathConfirmationInterviewer {
  async clarify(input: PathConfirmationInput): Promise<PathConfirmationStep> {
    const asked = input.transcript.filter((t) => t.role === "assistant").length;

    if (asked < QUESTIONS.length) {
      return { kind: "question", question: QUESTIONS[asked] };
    }

    // Synthesize the concern from the most recent learner answers so the Path
    // Adjuster has something concrete (and learner-grounded) to act on.
    const answers = input.transcript
      .filter((t) => t.role === "user")
      .map((t) => t.content.trim())
      .filter(Boolean);
    const concern =
      answers.length > 0
        ? `The learner says the proposed path is not quite right: "${answers.join(
            " ",
          )}". Revise the overview to address this before they start.`
        : "The learner indicated the path is not quite right but did not elaborate; make a conservative, minimal adjustment toward the stated outcomes.";

    return { kind: "complete", concern };
  }
}
