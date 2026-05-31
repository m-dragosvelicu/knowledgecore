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

Output ONLY the markdown content for the information step (no title heading is
required; the goalpost title is shown separately).`;

type TelemetrySnapshot = {
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  usage?: CompletionResult["usage"];
  model?: string;
};

export class LiveLessonContentGenerator implements LessonContentGenerator {
  constructor(private readonly llm: LLMClient) {}

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

    return {
      content: result.content,
      supportLevel: plan.supportLevel,
      workedExamples: plan.workedExamples,
    };
  }
}
