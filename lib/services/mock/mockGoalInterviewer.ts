import type {
  CanDoStatement,
  GoalInterviewer,
  GoalInterviewInput,
  InterviewStep,
} from "@/lib/services/types";

function isLinearAlgebraSubject(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("linear algebra") || lower.includes("math") || lower.includes("ml")
  );
}

const LINEAR_ALGEBRA_OUTCOMES: CanDoStatement[] = [
  {
    text: "I can implement gradient descent from scratch on a small linear-regression problem in NumPy and explain why it converges.",
    bloomLevel: "create",
  },
  {
    text: "I can compute dot products and matrix-vector products by hand and explain what they represent geometrically.",
    bloomLevel: "apply",
  },
  {
    text: "I can read a machine-learning paper that uses linear-algebra notation and follow the derivations without losing the thread.",
    bloomLevel: "understand",
  },
];

// Two canned questions, then completion. The interviewer is stateless: the step
// returned is a pure function of how many assistant questions the transcript
// already holds (driven by the client re-sending the transcript each turn).
const QUESTIONS = [
  "What does success look like for you with this — and by when do you want to get there?",
  "Is there a deadline, exam, or project shaping this, or anything you would rather skip?",
];

export class MockGoalInterviewer implements GoalInterviewer {
  async interview(input: GoalInterviewInput): Promise<InterviewStep> {
    const asked = input.transcript.filter((t) => t.role === "assistant").length;

    if (asked < QUESTIONS.length) {
      return { kind: "question", question: QUESTIONS[asked] };
    }

    const subject = input.subject.canonicalName;
    const canDoStatements = isLinearAlgebraSubject(subject)
      ? LINEAR_ALGEBRA_OUTCOMES
      : [
          {
            text: `I can explain the core concepts of ${subject} in my own words.`,
            bloomLevel: "understand" as const,
          },
          {
            text: `I can apply ${subject} techniques to solve a concrete problem.`,
            bloomLevel: "apply" as const,
          },
          {
            text: `I can teach the basics of ${subject} to a curious peer.`,
            bloomLevel: "evaluate" as const,
          },
        ];

    return {
      kind: "complete",
      canDoStatements,
      successCriterion: `You can confidently work with ${subject} at the level captured by the statements above.`,
    };
  }
}
