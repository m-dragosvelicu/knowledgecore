import { deriveSupportPlan } from "@/lib/journey/profileAdaptation";
import type {
  LessonContent,
  LessonContentGenerator,
  LessonContentInput,
} from "@/lib/services/lessonContent";

/**
 * Deterministic Call B mock. It honours the SAME derived support plan the live
 * generator does, so the visible adaptation (low mastery -> more worked examples,
 * extended support) is observable WITHOUT a real LLM. The verify-adaptation
 * script asserts exactly this: a low-mastery profile yields measurably more
 * worked examples / more support than a high-mastery one.
 */
export class MockLessonContentGenerator implements LessonContentGenerator {
  async generate(input: LessonContentInput): Promise<LessonContent> {
    const plan = deriveSupportPlan(input.profile, input.conceptKey);
    const topic = input.goalpost.title;

    const examples: string[] = [];
    for (let i = 1; i <= plan.workedExamples; i++) {
      examples.push(
        `### Worked example ${i}\n` +
          `Step through a concrete instance of "${topic}". ` +
          `Set it up, show each step, and state the result so it can be checked.`,
      );
    }

    const supportNote =
      plan.supportLevel === "extended"
        ? `> Going carefully here: terms are defined before they are used, the idea ` +
          `is broken into small steps, and a common-mistake note is included.`
        : plan.supportLevel === "minimal"
          ? `> Keeping this lean: basics you have already shown are skipped; the ` +
            `depth lives in the experience task.`
          : `> Standard pacing.`;

    const content = [
      `${input.goalpost.objective}`,
      ``,
      supportNote,
      ``,
      `This lesson builds toward being able to: ${input.endAchievement || topic}.`,
      ``,
      ...examples,
      ``,
      `Now apply this in the experience step that follows.`,
    ].join("\n");

    return {
      content,
      supportLevel: plan.supportLevel,
      workedExamples: plan.workedExamples,
    };
  }
}
