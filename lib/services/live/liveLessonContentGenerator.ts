import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd } from "@/lib/llm";
import { prisma } from "@/lib/db";
import {
  deriveSupportPlan,
  serializeProfileForGeneration,
} from "@/lib/journey/profileAdaptation";
import type {
  LessonContent,
  LessonContentGenerator,
  LessonContentInput,
} from "@/lib/services/lessonContent";
import type { VisualNeed } from "@/lib/services/visualMedia";
import { mediumForKind } from "@/lib/services/visual/gate";
import type { z } from "zod";
import { lessonContentResultSchema } from "./schemas";

type LessonResult = z.infer<typeof lessonContentResultSchema>;

const TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

// =====================================================================
// SYSTEM prompt — the STABLE prefix (no per-learner data here). Kept separate
// and constant so it can be cached (prompt caching, see GeminiClient.cacheKey):
// the per-learner profile + goalpost context goes in the user message, the
// invariant authoring rules stay in this system instruction.
// =====================================================================
const SYSTEM = `You are the lesson-authoring step of an AI learning platform.
You write the INFORMATION content for ONE goalpost of a learner's path: a
self-contained explainer the learner reads before attempting an active task.

Write rich markdown. Be concrete and worked-example-driven. The explainer is the
only place the learner receives information for this goalpost, so it must stand
alone and lead naturally into the experience task you are told about.

You will be given a LEARNER PROFILE and an ADAPTATION DIRECTIVE derived from it.
TREAT THE DIRECTIVE AS BINDING:
- Honour the requested SUPPORT LEVEL and the MINIMUM number of worked examples.
- More support / more worked examples for a struggling learner; leaner content
  for one who has shown mastery. Productive struggle is the default — add support
  because performance shows it is needed, never to "go faster" on request.
- Never mention the profile, the mastery numbers, the directive, or "support
  level" to the learner. Adaptation is SILENT: just write the better-fitting
  lesson.

Output the markdown content for the information step (no title heading is
required; the goalpost title is shown separately).

VISUAL AIDS (optional): alongside the markdown, you MAY propose 0-2 visual aids
that genuinely help THIS concept. Each visual carries a structured "visualKind"
that decides how it is realised — a thin code gate routes it, you do NOT pick the
medium:
- diagram | structural | quantitative: a schematic the concept needs (a flow, a
  structure, a labelled chart). For these you MUST author the SVG inline in
  "svgSource" — plain, static SVG only: shapes, paths, lines, text. NEVER include
  <script>, event handlers (onload/onclick/...), <foreignObject>, <image>, <use>,
  external href/src, or <style>. (Any such content is stripped before display.)
- photographic | real_world | human | situational: a real-world PHOTO. Do NOT
  draw it; instead give a short "query" describing the photo to source.
- process | motion: a step-by-step or dynamic concept best shown as a reference
  VIDEO. Give a "query" (a concrete YouTube watch URL or video id if you know a
  good one).
Choose a visualKind by what the CONCEPT needs, never by a learner "type". Set
"visuals" to [] when no visual genuinely helps. Always give each visual a stable
"id" and a one-line "caption" usable as alt text.`;

type TelemetrySnapshot = {
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  usage?: CompletionResult["usage"];
  model?: string;
};

export class LiveLessonContentGenerator implements LessonContentGenerator {
  constructor(private readonly llm: LLMClient) {}

  private async recordLlmCall(
    snapshot: TelemetrySnapshot,
    purpose: "lesson_content" | "visual_generate" = "lesson_content",
  ): Promise<void> {
    try {
      const model = snapshot.model ?? TELEMETRY_MODEL;
      const inputTokens = snapshot.usage?.inputTokens ?? 0;
      const outputTokens = snapshot.usage?.outputTokens ?? 0;
      await prisma.llmCall.create({
        data: {
          purpose,
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
        `[llm-telemetry] failed to persist lesson_content row: ${
          (err as Error).message
        }`,
      );
    }
  }

  async generate(input: LessonContentInput): Promise<LessonContent> {
    const plan = deriveSupportPlan(input.profile, input.conceptKey);
    // THE CORE OF L1: serialize the profile (mastery + signals + derived support
    // plan) into the plain-text user block, exactly as the Path Outliner formats
    // its typed fields. The system prompt stays invariant (cacheable).
    const profileBlock = serializeProfileForGeneration(
      input.profile,
      input.conceptKey,
    );

    const startedAt = Date.now();
    let usage: CompletionResult["usage"] | undefined;
    let usageModel: string | undefined;
    let result: LessonResult;
    try {
      result = await this.llm.completeStructured({
        system: SYSTEM,
        // A stable cache key over the invariant system prefix so the Gemini
        // client can reuse a cached prefix across goalposts/learners (see
        // GeminiClient prompt-caching plumbing). Per-learner text is NOT here.
        cacheKey: "lesson_content_system_v1",
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
              `Write the information content now.`,
            ].join("\n"),
          },
        ],
        temperature: 0.6,
        maxTokens: 4096,
        schema: lessonContentResultSchema,
        schemaName: "LessonContent",
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

    // L1 Slice 4 — normalize the emitted visual needs. Each carries a structured
    // visualKind the gate later routes. We keep ONLY the route-appropriate
    // payload (svgSource for SVG-route kinds, query for image/video routes) so a
    // mis-tagged blob can't smuggle an unexpected field downstream. The SVG is
    // still UNTRUSTED here — it is sanitized on its dedicated path at render time.
    const visuals: VisualNeed[] = (result.visuals ?? []).map((v) => {
      const medium = mediumForKind(v.visualKind);
      return {
        id: v.id,
        visualKind: v.visualKind,
        caption: v.caption,
        query: medium === "svg" ? undefined : v.query ?? undefined,
        svgSource: medium === "svg" ? v.svgSource ?? undefined : undefined,
      };
    });

    // When the lesson produced any diagram-route (SVG) visual, record the
    // dedicated `visual_generate` telemetry row (the SVG-authoring half of this
    // call). Best-effort, same as the lesson_content row above.
    if (visuals.some((v) => mediumForKind(v.visualKind) === "svg")) {
      await this.recordLlmCall(
        {
          latencyMs: Date.now() - startedAt,
          success: true,
          errorMessage: null,
          usage,
          model: usageModel,
        },
        "visual_generate",
      );
    }

    return {
      content: result.content,
      supportLevel: plan.supportLevel,
      workedExamples: plan.workedExamples,
      visuals,
    };
  }
}
