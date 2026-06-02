import type { Author } from "@/lib/journey/lessonOrchestration";
import type { DraftLessonDoc } from "@/lib/services/lessonDoc";
import type { LessonContentInput } from "@/lib/services/lessonContent";

// Offline / keyless fallback for the Phase-1 Author. Returns a tiny valid
// DraftLessonDoc so the orchestrator and keyless verify scripts run without a
// model. No visual blocks: nothing to resolve, prose stands alone.
export class MockLessonAuthor implements Author {
  async author(input: LessonContentInput): Promise<DraftLessonDoc> {
    return {
      sections: [
        {
          id: `${input.conceptKey}-s0`,
          heading: input.goalpost.title,
          blocks: [
            {
              type: "prose",
              id: `${input.conceptKey}-b0`,
              md: `${input.goalpost.objective}\n\nThis lesson builds toward: ${input.endAchievement || input.goalpost.title}.`,
            },
          ],
        },
      ],
    };
  }
}
