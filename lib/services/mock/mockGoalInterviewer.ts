import type {
  CanDoStatement,
  GoalInterviewer,
  GoalInterviewInput,
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

export class MockGoalInterviewer implements GoalInterviewer {
  async interview(
    input: GoalInterviewInput,
  ): Promise<{ canDoStatements: CanDoStatement[] }> {
    const subject = input.subject.canonicalName;
    if (isLinearAlgebraSubject(subject)) {
      return { canDoStatements: LINEAR_ALGEBRA_OUTCOMES };
    }
    return {
      canDoStatements: [
        { text: `I can explain the core concepts of ${subject} in my own words.`, bloomLevel: "understand" },
        { text: `I can apply ${subject} techniques to solve a concrete problem.`, bloomLevel: "apply" },
        { text: `I can teach the basics of ${subject} to a curious peer.`, bloomLevel: "evaluate" },
      ],
    };
  }
}
