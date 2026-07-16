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
import { LESSON_AUTHOR_SYSTEM } from "@/lib/llm/prompts/lessonAuthorPrompts";

type AuthoredLesson = z.infer<typeof authoredLessonSchema>;

const TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

type TelemetrySnapshot = {
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  usage?: CompletionResult["usage"];
  model?: string;
};

/** Gemini-backed Author: one structured call per goalpost (Phase 1). */
export class LessonAuthor implements Author {
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
        system: LESSON_AUTHOR_SYSTEM,
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
        "LessonAuthor produced no usable prose/visual blocks for the lesson.",
      );
    }

    return { sections };
  }
}
