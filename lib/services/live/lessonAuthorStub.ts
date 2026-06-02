/**
 * L1 — Two-Phase Visual Lesson Pipeline.
 *
 * TODO(Slice 2 — AI Engineer): REPLACE this stub with the real Phase-1 Author.
 * The real Author is one structured model call whose schema has NO draw field
 * (no svgSource), making ASCII art structurally impossible. It must return a
 * DraftLessonDoc whose visual blocks are all `status: "pending"` with a rich
 * `spec` and a `kind` from the closed visualKind set. See the redesign doc §6
 * and the `Author` port in lib/journey/lessonOrchestration.ts.
 *
 * Until Slice 2 lands, this stub bridges the EXISTING single-call generator
 * (LiveLessonContentGenerator / its mock) into the new LessonDoc container so the
 * orchestrator skeleton is end-to-end runnable and the goalpost surface keeps
 * working: it takes the legacy { content: markdown, visuals } and folds it into
 * a one-section DraftLessonDoc (the whole markdown as a single prose block; each
 * legacy VisualNeed becomes a pending visual block carrying its caption as the
 * spec). This is a SEAM, not the final Author — the two interim fixes in
 * liveLessonContentGenerator.ts stay intact and keep flowing through here.
 */

import type { Author } from "@/lib/journey/lessonOrchestration";
import type { DraftLessonDoc } from "@/lib/services/lessonDoc";
import type {
  LessonContentGenerator,
  LessonContentInput,
} from "@/lib/services/lessonContent";

export class LegacyGeneratorAuthorStub implements Author {
  constructor(private readonly generator: LessonContentGenerator) {}

  async author(input: LessonContentInput): Promise<DraftLessonDoc> {
    const lesson = await this.generator.generate(input);

    // The legacy generator emits the whole lesson as one markdown string plus a
    // flat list of visual needs. Fold it into a single section: one prose block
    // for the markdown, then one pending visual block per legacy need. Slice 2's
    // real Author will instead emit MULTIPLE prose/visual blocks interleaved.
    const blocks = [
      {
        type: "prose" as const,
        id: `${input.conceptKey}-prose-0`,
        md: lesson.content,
      },
      ...(lesson.visuals ?? []).map((need) => ({
        type: "visual" as const,
        id: need.id,
        kind: need.visualKind,
        // The legacy need's caption is the closest thing to a Phase-1 "spec".
        // The legacy svgSource/query are intentionally DROPPED here: under the
        // new pipeline the Phase-2 worker (Slice 3) re-derives the rendered
        // payload from the spec, so the Author stage carries no drawn figure.
        spec: need.caption,
        status: "pending" as const,
      })),
    ];

    return {
      sections: [
        {
          id: `${input.conceptKey}-section-0`,
          heading: input.goalpost.title,
          blocks,
        },
      ],
    };
  }
}
