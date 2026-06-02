/**
 * L1 — Two-Phase Visual Lesson Pipeline (Slice 2): the real Phase-1 AUTHOR.
 *
 * This is the heart of the redesign. The Author is ONE structured Gemini call
 * that turns a goalpost's context into an ordered LessonDoc of PROSE blocks and
 * visual SPECS. It implements the `Author` port from lib/journey/lessonOrchestration.ts.
 *
 * THE ANTI-ASCII GUARANTEE (redesign §6). The Author's structured-output schema
 * (`authoredLessonSchema` in ./schemas) has NO field through which a drawn figure
 * can be emitted — no svgSource, no svg, no ASCII canvas. A visual block carries
 * only { kind, spec }. The model therefore CANNOT draw a diagram, in ASCII or
 * otherwise; it can only DESCRIBE one. The drawn payload is produced later by a
 * dedicated Phase-2 worker (Slice 3) from `spec`. ASCII art is structurally
 * impossible, not merely forbidden.
 *
 * PROSE STANDS ALONE (redesign §6). Each prose block must read as a complete
 * explainer even if a sibling visual is later dropped (retry-then-drop is the
 * Phase-2 failure policy). The system prompt makes "no verbal visual dependency"
 * a HARD rule: no "see the diagram below", "as shown above", "the figure
 * illustrates". Visuals are optional reinforcement; the words carry the lesson.
 *
 * PROFILE ADAPTATION carries over from the legacy generator unchanged: the same
 * deriveSupportPlan / serializeProfileForGeneration drive the SILENT support-level
 * and worked-example minimums, injected as plain text into the user message; the
 * invariant authoring rules stay in the cacheable SYSTEM prefix (cacheKey).
 */

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

// =====================================================================
// SYSTEM prompt — the STABLE, cacheable prefix (no per-learner data here). The
// per-learner profile + goalpost context go in the user message; these invariant
// authoring rules stay in this system instruction so the Gemini client can reuse
// a cached prefix across goalposts/learners (cacheKey below).
//
// Carried over from the legacy generator: the profile-adaptation directive (honour
// the support level + worked-example minimums; silent adaptation). NEW: the output
// is the BLOCK STRUCTURE, the Author describes visuals (never draws), and prose
// must stand alone.
// =====================================================================
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

  /**
   * Best-effort per-call telemetry, mirroring the other live services. The
   * Author IS the (former) Call B, so its purpose stays `lesson_content` for
   * continuity of the existing telemetry series. Never allowed to break authoring.
   */
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
    // Profile adaptation is unchanged from the legacy generator: the derived plan
    // (support level + worked-example minimum) is rendered into the user message
    // and treated as binding. supportLevel/workedExamples telemetry intent is kept
    // here as plan-derived values; the Author's CONTRACT is the DraftLessonDoc, so
    // those audit fields are not persisted on the doc (see report's open note).
    const plan = deriveSupportPlan(input.profile, input.conceptKey);
    void plan; // derived for the prompt block below; not part of the DraftLessonDoc.
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
        // Stable cache key over the invariant system prefix so the Gemini client
        // can reuse a cached prefix across goalposts/learners. Per-learner text is
        // NOT in the system prompt — it is in the user message below.
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
        // Generous ceiling, NOT a tuned limit. Hidden thinking tokens still count
        // against the cap even though thinkingBudget=0 for structured calls
        // (redesign §14), and we are billed for ACTUAL output tokens (not the cap),
        // so a high ceiling only removes truncation risk. Carried over from the
        // interim 4096->32768 raise; do NOT tune tight from visible-token counts.
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

  /**
   * Normalize the flat authored blocks into the typed DraftLessonDoc the
   * orchestrator consumes. The schema models a block as ONE flat object (a
   * converter constraint: Gemini has no oneOf/anyOf), so we split it by `type`
   * here — exactly as liveGoalInterviewer normalizes its flat interview step.
   *
   * The orchestrator owns ids + lifecycle, but the DraftLessonDoc types require
   * stable ids, so we assign deterministic ids here (concept-scoped, ordinal).
   * Every visual block is stamped status "pending" with NO payload: the Author
   * cannot draw, so a worker resolves it later.
   *
   * Blocks that do not carry the field their `type` requires (an empty prose md,
   * or a visual missing kind/spec) are DROPPED defensively — a malformed block
   * never reaches the renderer. A section left with no usable block is dropped.
   */
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
          if (!md) continue; // malformed prose block -> drop
          blocks.push({
            type: "prose",
            id: `${conceptKey}-b${blockOrdinal++}`,
            md,
          });
        } else {
          // visual
          const kind = block.kind ?? undefined;
          const spec = (block.spec ?? "").trim();
          if (!kind || !spec) continue; // malformed visual block -> drop
          blocks.push({
            type: "visual",
            id: `${conceptKey}-b${blockOrdinal++}`,
            kind,
            spec,
            status: "pending",
          });
        }
      }

      if (blocks.length === 0) return; // empty section -> drop
      sections.push({
        id: `${conceptKey}-s${sectionIndex}`,
        heading: section.heading,
        blocks,
      });
    });

    // Degenerate guard: the model returned nothing usable. Surface a real failure
    // (the orchestrator treats an Author throw as terminal -> "failed" state +
    // Try again) rather than persisting an empty lesson.
    if (sections.length === 0) {
      throw new Error(
        "LiveLessonAuthor produced no usable prose/visual blocks for the lesson.",
      );
    }

    return { sections };
  }
}
