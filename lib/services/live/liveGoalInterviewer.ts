import type { LLMClient } from "@/lib/llm";
import type {
  CanDoStatement,
  GoalInterviewer,
  GoalInterviewInput,
} from "@/lib/services/types";
import { goalInterviewResultSchema } from "./schemas";

const SYSTEM = `You are the goal-setting step of an AI learning platform. Given a
subject, the learner's motivation, and what they elaborated, produce 3 to 4
concrete "I can..." outcome statements (can-do statements) that define what
success looks like for THIS learner.

Rules:
- Each statement must start with "I can" and describe an observable, assessable
  capability, not a vague feeling.
- Tailor the difficulty and framing to the stated motivation (e.g. "work" leans
  applied/practical; "curiosity" leans conceptual; "school" leans exam-style).
- Tag each with the closest Bloom level: remember, understand, apply, analyze,
  evaluate, or create.
- Order them roughly from foundational to ambitious.`;

export class LiveGoalInterviewer implements GoalInterviewer {
  constructor(private readonly llm: LLMClient) {}

  async interview(
    input: GoalInterviewInput,
  ): Promise<{ canDoStatements: CanDoStatement[] }> {
    const result = await this.llm.completeStructured({
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            `Subject: ${input.subject.canonicalName}`,
            `Scope: ${input.subject.scopeNote}`,
            `Motivation: ${input.motivation}`,
            `Time horizon: ${input.timeHorizon ?? "unspecified"}`,
            `Learner elaboration: ${input.elaboration || "(none provided)"}`,
            ``,
            `Produce the can-do statements.`,
          ].join("\n"),
        },
      ],
      temperature: 0.5,
      schema: goalInterviewResultSchema,
      schemaName: "GoalInterviewResult",
    });
    return { canDoStatements: result.canDoStatements };
  }
}
