import { deriveSupportPlan } from "@/lib/journey/profileAdaptation";
import type {
  LessonContent,
  LessonContentGenerator,
  LessonContentInput,
} from "@/lib/services/lessonContent";
import type { VisualNeed } from "@/lib/services/visualMedia";

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

    // L1 Slice 4 — deterministic visual needs, one per route, so the gate and
    // the VisualMedia component are exercisable without an LLM. The SVG carries a
    // clean static diagram; the image/video routes carry a query the mock sources
    // resolve offline.
    const visuals: VisualNeed[] = [
      {
        id: "vis-diagram",
        visualKind: "diagram",
        caption: `Schematic of ${topic}`,
        svgSource:
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80">` +
          `<rect x="10" y="20" width="80" height="40" fill="#e0e7ff" stroke="#3730a3"/>` +
          `<text x="50" y="45" text-anchor="middle" font-size="10">input</text>` +
          `<line x1="90" y1="40" x2="130" y2="40" stroke="#3730a3" stroke-width="2"/>` +
          `<rect x="130" y="20" width="60" height="40" fill="#dcfce7" stroke="#166534"/>` +
          `<text x="160" y="45" text-anchor="middle" font-size="10">output</text>` +
          `</svg>`,
      },
      {
        id: "vis-photo",
        visualKind: "photographic",
        caption: `A real-world photo illustrating ${topic}`,
        query: topic,
      },
      {
        id: "vis-video",
        visualKind: "process",
        caption: `A reference video of the ${topic} process`,
        query: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
    ];

    return {
      content,
      supportLevel: plan.supportLevel,
      workedExamples: plan.workedExamples,
      visuals,
    };
  }
}
