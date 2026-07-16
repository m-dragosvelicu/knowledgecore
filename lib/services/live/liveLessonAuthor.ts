// Phase-1 Author: ONE structured Gemini call turning a goalpost's context into an
// ordered DraftLessonDoc of prose blocks and visual SPECS (the Author port). Its
// schema has no draw field, so ASCII art is structurally impossible (redesign §6);
// a Phase-2 worker renders each spec later.

import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd } from "@/lib/llm";
import { prisma } from "@/lib/db";
import {
  deriveSupportPlan,
  serializeProfileForGeneration,
} from "@/lib/journey/profileAdaptation";
import type { Author } from "@/lib/journey/lessonOrchestration";
import type {
  DraftLessonDoc,
  ProseBlock,
  Section,
  VisualBlock,
} from "@/lib/services/lessonDoc";
import type { LessonContentInput } from "@/lib/services/lessonContent";
import type { z } from "zod";
import { authoredLessonSchema } from "./schemas";

type AuthoredLesson = z.infer<typeof authoredLessonSchema>;

const TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

// Stable, cacheable system prefix (no per-learner data); the profile + goalpost
// context go in the user message so the client reuses a cached prefix (cacheKey below).
const SYSTEM = `You are the lesson-authoring step of an AI learning platform.
You write the INFORMATION content for ONE goalpost of a learner's path: a
self-contained explainer the learner reads before attempting an active task.

You output an ORDERED STRUCTURE of blocks grouped into sections. There are exactly
two block types and you fill each block's fields by its "type":
- A "prose" block: set "md" to a passage of rich markdown. Leave "kind" and "spec"
  empty. Use as many prose blocks as the lesson needs.
- A "visual" block: a request for a picture that genuinely helps THIS concept. Set
  "kind" (the visual category) and "spec" (a rich DESCRIPTION of what the picture
  must show). Leave "md" empty. A visual block requests a picture; it does NOT
  contain one.

YOU DO NOT DRAW. CRITICAL. You have NO way to produce a figure, a diagram, an SVG,
or any drawn shape — there is no field for it and there never will be. A separate
specialist later renders each visual from your "spec". So when a concept needs a
picture or a structure shown, you do TWO things and only these two:
1. EXPLAIN IT FULLY IN WORDS in a prose block (describe the structure, the values,
   the relationships in plain language so the prose alone teaches the idea), and
2. add a "visual" block whose "spec" tells the specialist exactly what to draw.
NEVER attempt to draw with text: no ASCII art, no trees/graphs/boxes/arrows made of
slashes, pipes, dashes, or characters in a code fence or monospace block (e.g.
"A / \\ B C"). Code fences are reserved STRICTLY for real code, commands, or literal
output (e.g. the value sequence a traversal produces) — never for drawn shapes.

PROSE MUST STAND ALONE. CRITICAL. A visual may be dropped before the learner sees
it (the specialist can fail to render it cleanly), so the prose must read as a
COMPLETE explainer with every visual removed. Therefore a prose block MUST NOT
contain any verbal dependency on a visual: never write "see the diagram below",
"as shown above", "in the figure", "the illustration shows", "the chart on the
right", or anything that only makes sense if the picture is present. Describe what
matters directly in words; treat visuals as optional reinforcement, not as a
load-bearing part of the explanation.

VISUAL "kind" — pick by what the CONCEPT needs, never by a learner "type". The kind
decides which specialist renders it (you do NOT choose the medium):
- diagram | structural | quantitative: a schematic, structure, flow, or labelled
  chart the concept needs.
- photographic | real_world | human | situational: a real-world photo.
- process | motion: a step-by-step or dynamic concept best shown as a moving
  reference.
A "visual" block's "spec" must be specific and self-contained: state exactly what
to show, the labels/values/nodes/axes, and the intent, so the specialist can render
it from the spec ALONE. Propose 0-2 visuals total — only where a picture genuinely
helps. When no visual helps, simply emit no visual blocks.

You will be given a LEARNER PROFILE and an ADAPTATION DIRECTIVE derived from it.
TREAT THE DIRECTIVE AS BINDING:
- Honour the requested SUPPORT LEVEL and the MINIMUM number of worked examples.
- More support / more worked examples for a struggling learner; leaner content for
  one who has shown mastery. Productive struggle is the default — add support
  because performance shows it is needed, never to "go faster" on request.
- Never mention the profile, the mastery numbers, the directive, or "support level"
  to the learner. Adaptation is SILENT: just write the better-fitting lesson.

No top-level title heading is required (the goalpost title is shown separately).
Give each section a short "heading". Write the lesson so it leads naturally into the
experience task you are told about, but do NOT solve that task for the learner.`;

type TelemetrySnapshot = {
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  usage?: CompletionResult["usage"];
  model?: string;
};

export class LiveLessonAuthor implements Author {
  constructor(private readonly llm: LLMClient) {}

  // Best-effort telemetry; never breaks authoring. Purpose stays `lesson_content`
  // (the Author is the former Call B) for continuity of the existing series.
  private async recordLlmCall(snapshot: TelemetrySnapshot): Promise<void> {
    try {
      const model = snapshot.model ?? TELEMETRY_MODEL;
      const inputTokens = snapshot.usage?.inputTokens ?? 0;
      const outputTokens = snapshot.usage?.outputTokens ?? 0;
      await prisma.llmCall.create({
        data: {
          purpose: "lesson_content",
          model,
          inputTokens,
          outputTokens,
          costMicroUsd: computeCostMicroUsd(model, inputTokens, outputTokens),
          latencyMs: snapshot.latencyMs,
          success: snapshot.success,
          errorMessage: snapshot.errorMessage,
          evaluationId: null,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[llm-telemetry] failed to persist lesson_content (author) row: ${
          (err as Error).message
        }`,
      );
    }
  }

  async author(input: LessonContentInput): Promise<DraftLessonDoc> {
    // The derived support plan feeds the prompt via serializeProfileForGeneration;
    // it is not part of the DraftLessonDoc contract.
    const profileBlock = serializeProfileForGeneration(
      input.profile,
      input.conceptKey,
    );

    const startedAt = Date.now();
    let usage: CompletionResult["usage"] | undefined;
    let usageModel: string | undefined;
    let result: AuthoredLesson;
    try {
      result = await this.llm.completeStructured({
        system: SYSTEM,
        cacheKey: "lesson_author_system_v1",
        messages: [
          {
            role: "user",
            content: [
              `Subject: ${input.subject.canonicalName}`,
              `Scope: ${input.subject.scopeNote}`,
              ``,
              `Goalpost ${input.goalpost.order}: ${input.goalpost.title}`,
              `Objective: ${input.goalpost.objective}`,
              ``,
              `The learner will then face this experience task (align the lesson to it, but do NOT solve it for them):`,
              input.experiencePrompt || "(none provided)",
              ``,
              `By the end of the whole path the learner should be able to: ${input.endAchievement || "(not specified)"}`,
              ``,
              `Assessed competencies (level 0-4, confidence 0-1):`,
              ...(input.assessment.length
                ? input.assessment.map(
                    (c) =>
                      `- ${c.competency}: level ${c.estimatedLevel} (confidence ${c.confidence})`,
                  )
                : ["- (no assessment available; assume a motivated beginner)"]),
              ``,
              profileBlock,
              ``,
              `Author the lesson now as sections of prose and visual blocks. Remember: you describe visuals, you never draw them; prose must stand alone.`,
            ].join("\n"),
          },
        ],
        temperature: 0.6,
        // Generous ceiling, not a tuned limit: hidden thinking tokens draw from the
        // same budget and we are billed for actual output, so a high cap only removes
        // truncation risk. Do not tune tight from visible-token counts.
        maxTokens: 32768,
        schema: authoredLessonSchema,
        schemaName: "AuthoredLesson",
        onUsage: (u, m) => {
          usage = u;
          usageModel = m;
        },
      });
    } catch (err) {
      await this.recordLlmCall({
        latencyMs: Date.now() - startedAt,
        success: false,
        errorMessage: (err as Error).message,
        usage,
        model: usageModel,
      });
      throw err;
    }

    await this.recordLlmCall({
      latencyMs: Date.now() - startedAt,
      success: true,
      errorMessage: null,
      usage,
      model: usageModel,
    });

    return this.toDraftLessonDoc(result, input.conceptKey);
  }

  // Splits the flat authored blocks into the typed DraftLessonDoc, assigning
  // deterministic concept-scoped ids; visual blocks start "pending" for a
  // worker to resolve. Malformed blocks and emptied sections are dropped.
  private toDraftLessonDoc(
    authored: AuthoredLesson,
    conceptKey: string,
  ): DraftLessonDoc {
    let blockOrdinal = 0;
    const sections: Section[] = [];

    authored.sections.forEach((section, sectionIndex) => {
      const blocks: (ProseBlock | VisualBlock)[] = [];

      for (const block of section.blocks) {
        if (block.type === "prose") {
          const md = (block.md ?? "").trim();
          if (!md) continue;
          blocks.push({
            type: "prose",
            id: `${conceptKey}-b${blockOrdinal++}`,
            md,
          });
        } else {
          const kind = block.kind ?? undefined;
          const spec = (block.spec ?? "").trim();
          if (!kind || !spec) continue;
          blocks.push({
            type: "visual",
            id: `${conceptKey}-b${blockOrdinal++}`,
            kind,
            spec,
            status: "pending",
          });
        }
      }

      if (blocks.length === 0) return;
      sections.push({
        id: `${conceptKey}-s${sectionIndex}`,
        heading: section.heading,
        blocks,
      });
    });

    // Nothing usable: throw so the orchestrator surfaces a real failure rather than
    // persisting an empty lesson (it treats an Author throw as terminal).
    if (sections.length === 0) {
      throw new Error(
        "LiveLessonAuthor produced no usable prose/visual blocks for the lesson.",
      );
    }

    return { sections };
  }
}
