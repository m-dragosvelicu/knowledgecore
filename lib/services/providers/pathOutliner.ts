import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd } from "@/lib/llm";
import { prisma } from "@/lib/db";
import type {
  GoalpostPlan,
  PathOutliner,
  PathOutlinerInput,
} from "@/lib/services/types";
import type { z } from "zod";
import { pathResultSchema } from "./schemas";
import { PATH_OUTLINER_SYSTEM } from "@/lib/llm/prompts/pathOutlinerPrompts";

type PathResult = z.infer<typeof pathResultSchema>;

// Fallback model id for telemetry when a failure short-circuits before onUsage fires.
const TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

// L0.md §9.1 granularity: hard bounds 20-120, target 30-90; the model is unreliable
// about this, so we clamp in code.
const MIN_MINUTES = 20;
const MAX_MINUTES = 120;
const TARGET_MIN_MINUTES = 30;
const TARGET_MAX_MINUTES = 90;

// A well-formed experience prompt cannot be a degenerate fragment. Anything
// shorter than this is treated as malformed (the line-of-questions bug).
const MIN_PROMPT_CHARS = 20;

// A competency whose estimatedLevel is at or below this is a GAP the path must
// cover (L0.md §5). Used by the non-fatal coverage check.
const GAP_LEVEL_THRESHOLD = 1;

type TelemetrySnapshot = {
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  usage?: CompletionResult["usage"];
  model?: string;
};

/** Gemini-backed PathOutliner: 3-goalpost curriculum design. */
export class GeminiPathOutliner implements PathOutliner {
  constructor(private readonly llm: LLMClient) {}

  // Best-effort telemetry; never breaks path outlining.
  private async recordLlmCall(snapshot: TelemetrySnapshot): Promise<void> {
    try {
      const model = snapshot.model ?? TELEMETRY_MODEL;
      const inputTokens = snapshot.usage?.inputTokens ?? 0;
      const outputTokens = snapshot.usage?.outputTokens ?? 0;
      await prisma.llmCall.create({
        data: {
          purpose: "path_outline",
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
        `[llm-telemetry] failed to persist path_outline row: ${(err as Error).message}`,
      );
    }
  }

  async outline(input: PathOutlinerInput): Promise<GoalpostPlan[]> {
    const startedAt = Date.now();
    let usage: CompletionResult["usage"] | undefined;
    let usageModel: string | undefined;
    let result: PathResult;
    try {
      result = await this.llm.completeStructured({
        system: PATH_OUTLINER_SYSTEM,
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
              `The WEAK competencies you must cover across the path (level <= ${GAP_LEVEL_THRESHOLD}):`,
              ...(this.weakCompetencies(input).length
                ? this.weakCompetencies(input).map((c) => `- ${c}`)
                : ["- (none flagged; treat the learner as a motivated beginner)"]),
              ``,
              `Design the 3-goalpost path.`,
            ].join("\n"),
          },
        ],
        temperature: 0.6,
        maxTokens: 8192,
        schema: pathResultSchema,
        schemaName: "LearningPath",
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

    // Reshape into the GoalpostPlan { steps[] } the wizard persists, applying the L0
    // hard-constraint guards in code (the model is unreliable about them).
    const plans: GoalpostPlan[] = result.goalposts.map((gp) => {
      const estimatedMinutes = this.clampMinutes(gp.estimatedMinutes, gp.title);
      const prompt = this.repairExperiencePrompt(
        gp.experience.prompt,
        gp.title,
        gp.objective,
        gp.experience.type,
      );

      return {
        order: gp.order,
        title: gp.title,
        objective: gp.objective,
        estimatedMinutes,
        steps: [
          {
            order: gp.information.order,
            type: gp.information.type,
            // SKELETON ONLY (redesign §9): empty content + no contentGeneratedAt keeps
            // the step "not yet generated", so ensureLessonContent authors the real
            // LessonDoc on entry.
            payload: { content: "", sourceIds: [] },
          },
          {
            order: gp.experience.order,
            type: gp.experience.type,
            payload: {
              prompt,
              rubricFocus: gp.experience.rubricFocus,
            },
          },
        ],
      };
    });

    // Non-fatal coverage check; the prompt is the primary enforcement (L0.md §5).
    this.warnOnUncoveredGaps(input, plans);

    return plans;
  }

  /** Competencies the assessment flagged as weak (a gap the path must cover). */
  private weakCompetencies(input: PathOutlinerInput): string[] {
    return input.assessment
      .filter((c) => c.estimatedLevel <= GAP_LEVEL_THRESHOLD)
      .map((c) => c.competency);
  }

  // Hard-clamp to [20,120], then nudge into the 30-90 target band (L0.md §9.1).
  private clampMinutes(raw: number, title: string): number {
    const safe = Number.isFinite(raw) ? Math.round(raw) : TARGET_MIN_MINUTES;
    const clamped = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, safe));
    if (clamped !== safe) {
      // eslint-disable-next-line no-console
      console.warn(
        `[path-outliner] estimatedMinutes ${safe} for goalpost "${title}" out of hard bounds [${MIN_MINUTES}, ${MAX_MINUTES}]; clamped to ${clamped}.`,
      );
    }
    if (clamped < TARGET_MIN_MINUTES) return TARGET_MIN_MINUTES;
    if (clamped > TARGET_MAX_MINUTES) return Math.min(clamped, MAX_MINUTES);
    return clamped;
  }

  // A prompt shorter than MIN_PROMPT_CHARS is degenerate; substitute a well-formed
  // self-contained fallback built from the objective rather than ship it.
  private repairExperiencePrompt(
    raw: string,
    title: string,
    objective: string,
    type: GoalpostPlan["steps"][number]["type"],
  ): string {
    const trimmed = (raw ?? "").trim();
    if (trimmed.length >= MIN_PROMPT_CHARS) return trimmed;

    // eslint-disable-next-line no-console
    console.warn(
      `[path-outliner] malformed experience prompt for goalpost "${title}" (length ${trimmed.length} < ${MIN_PROMPT_CHARS}); substituting a generated fallback task.`,
    );

    const focus = objective.trim() || title.trim();
    switch (type) {
      case "experience_socratic":
        return `In your own words, explain the core idea behind "${focus}". Walk through WHY it works the way it does, and give one concrete example that shows you understand it rather than just restating a definition.`;
      case "experience_mini_project":
        return `Produce a small artifact that demonstrates "${focus}". Keep it focused: state your goal in one sentence, build the smallest thing that proves the concept, and write 3-4 sentences explaining the choices you made.`;
      case "experience_applied_problem":
      default:
        return `Work through a concrete problem that applies "${focus}". Set up the problem, show every step of your reasoning and arithmetic, and state the final result clearly so it can be checked.`;
    }
  }

  // Warns once per weak competency whose name appears in no goalpost objective
  // (best-effort QA signal, not a hard gate; L0.md §5).
  private warnOnUncoveredGaps(
    input: PathOutlinerInput,
    plans: GoalpostPlan[],
  ): void {
    const weak = this.weakCompetencies(input);
    if (weak.length === 0) return;

    const objectives = plans
      .map((p) => `${p.title}\n${p.objective}`.toLowerCase())
      .join("\n");

    for (const competency of weak) {
      if (!objectives.includes(competency.toLowerCase())) {
        // eslint-disable-next-line no-console
        console.warn(
          `[path-outliner] gap competency "${competency}" was flagged weak but appears in no goalpost objective; the path may not cover it (L0.md §5).`,
        );
      }
    }
  }
}
