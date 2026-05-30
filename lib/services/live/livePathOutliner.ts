import type { LLMClient } from "@/lib/llm";
import type {
  GoalpostPlan,
  PathOutliner,
  PathOutlinerInput,
} from "@/lib/services/types";
import { pathResultSchema } from "./schemas";

const SYSTEM = `You are the curriculum-design step of an AI learning platform.
Design a short learning PATH of 3 goalposts that takes THIS learner from where
they are now (their assessed competencies) to their stated outcomes.

Each goalpost has exactly two steps:
1. An "information" step: a self-contained explainer the learner reads. Write it
   as rich markdown of roughly 250-500 words. Be concrete, use at least one
   worked micro-example, and connect the idea to the learner's motivation. This
   is the only place the learner receives information, so it must stand alone.
2. An "experience" step: a single active task that forces the learner to USE the
   idea from the information step. Choose the type:
   - experience_socratic: answer a probing conceptual question in their own words
   - experience_applied_problem: solve a concrete problem and show their work
   - experience_mini_project: build/produce a small artifact
   Give it a clear prompt and list which rubric dimensions it targets
   (rubricFocus) from: recall, application, conceptual, transfer, communication,
   coverage.

Rules:
- Order goalposts 1..3 from foundational to ambitious.
- Skip what the learner already knows (use their competency levels); spend time
  where they are weak.
- estimatedMinutes is a realistic per-goalpost estimate.
- Number the information step order 1 and the experience step order 2.`;

export class LivePathOutliner implements PathOutliner {
  constructor(private readonly llm: LLMClient) {}

  async outline(input: PathOutlinerInput): Promise<GoalpostPlan[]> {
    const result = await this.llm.completeStructured({
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            `Subject: ${input.subject.canonicalName}`,
            `Scope: ${input.subject.scopeNote}`,
            `Motivation: ${input.motivation}`,
            ``,
            `Target outcomes:`,
            ...input.outcome.map((o) => `- (${o.bloomLevel}) ${o.text}`),
            ``,
            `Assessed competencies (level 0-4, confidence 0-1):`,
            ...(input.assessment.length
              ? input.assessment.map(
                  (c) =>
                    `- ${c.competency}: level ${c.estimatedLevel} (confidence ${c.confidence})`,
                )
              : ["- (no assessment available; assume a motivated beginner)"]),
            ``,
            `Design the 3-goalpost path.`,
          ].join("\n"),
        },
      ],
      temperature: 0.6,
      maxTokens: 8192,
      schema: pathResultSchema,
      schemaName: "LearningPath",
    });

    // Reshape into the GoalpostPlan { steps[] } structure the wizard persists.
    return result.goalposts.map((gp) => ({
      order: gp.order,
      title: gp.title,
      objective: gp.objective,
      estimatedMinutes: gp.estimatedMinutes,
      steps: [
        {
          order: gp.information.order,
          type: gp.information.type,
          payload: { content: gp.information.content, sourceIds: [] },
        },
        {
          order: gp.experience.order,
          type: gp.experience.type,
          payload: {
            prompt: gp.experience.prompt,
            rubricFocus: gp.experience.rubricFocus,
          },
        },
      ],
    }));
  }
}
