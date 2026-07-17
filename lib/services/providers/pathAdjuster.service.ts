import { z } from "zod";
import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd } from "@/lib/llm";
import { prisma } from "@/lib/db";
import type { PathAdjusterInput, PathAdjustment } from "@/lib/services/types";
import type { PathAdjuster } from "@/lib/services/interfaces/pathAdjuster.interface";
import { buildPathAdjusterSystem } from "@/lib/llm/prompts/pathAdjusterPrompts";

// Fallback model id for telemetry when a failure short-circuits before onUsage fires.
const TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

// PathAdjustment schema, defined locally (mirrors lib/services/types.ts).
const rubricFocusSchema = z.enum([
  "recall",
  "application",
  "conceptual",
  "transfer",
  "communication",
  "coverage",
]);

const insertedStepTypeSchema = z.enum([
  "information",
  "experience_socratic",
  "experience_applied_problem",
  "experience_mini_project",
]);

// Flat object, not a union (Gemini's converter has no oneOf/anyOf — see
// lib/llm/gemini.ts zodToGeminiSchema; mirrors the same flattening already used
// by interviewStepSchema in goalInterviewer.service.ts and authoredBlockSchema in
// lessonAuthor.service.ts). Discriminated
// by `type`; fields belonging to the other variant are nullish. SKELETON ONLY
// (redesign §9) for information steps: the two-phase pipeline authors `content`
// on entry, so no content field exists here. superRefine below reinstates the
// exact per-variant requiredness the two separate schemas used to enforce
// (prompt required and non-empty for experience steps).
const insertedStepSchema = z
  .object({
    order: z.number().int(),
    type: insertedStepTypeSchema,
    sourceIds: z.array(z.string()).nullish(),
    prompt: z.string().nullish(),
    rubricFocus: z.array(rubricFocusSchema).nullish(),
  })
  .superRefine((step, ctx) => {
    if (step.type !== "information" && !step.prompt?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prompt"],
        message: "Experience steps require a non-empty prompt.",
      });
    }
  });

const insertedGoalpostSchema = z
  .object({
    order: z.number().int(),
    title: z.string().min(1),
    objective: z.string().min(1),
    estimatedMinutes: z.number().int().min(20).max(120),
    steps: z.array(insertedStepSchema).min(2),
  })
  .refine(
    (gp) =>
      gp.steps.some((s) => s.type === "information") &&
      gp.steps.some((s) => s.type !== "information"),
    {
      message:
        "Each inserted goalpost needs >=1 information step and >=1 experience step.",
    },
  );

const modifiedGoalpostSchema = z.object({
  order: z.number().int(),
  title: z.string().min(1).nullish(),
  objective: z.string().min(1).nullish(),
  estimatedMinutes: z.number().int().min(20).max(120).nullish(),
});

// Base contract: any number of inserts (including zero) is valid. Used as-is
// for the confirmation_revision mode, where a pure removal/modification is a
// legitimate response to a pre-acceptance concern.
export const pathAdjustmentSchema = z.object({
  insertedGoalposts: z.array(insertedGoalpostSchema),
  removedOrders: z.array(z.number().int()),
  modifiedGoalposts: z.array(modifiedGoalpostSchema),
  rationale: z.string().min(1),
});

// Remediation-only contract: empty inserts would let the failed goalpost get
// stamped complete downstream (applyPathAdjustment) instead of remediated —
// every post-checkpoint adjust_plan response must supply at least one
// remediation goalpost. PM ruling 2026-07-17: this is scoped to remediation
// only, NOT shared with the confirmation_revision mode. Schema violations
// here fail loudly with no retry, same as any other pathAdjustmentSchema
// violation (see completeStructured in lib/llm/gemini.ts: opts.schema.parse
// is not wrapped in the transient/truncation retry).
export const remediationPathAdjustmentSchema = pathAdjustmentSchema.extend({
  insertedGoalposts: z
    .array(insertedGoalpostSchema)
    .min(1, "adjust_plan remediation must insert at least one goalpost."),
});

type ParsedPathAdjustment = z.infer<typeof pathAdjustmentSchema>;

type TelemetrySnapshot = {
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  usage?: CompletionResult["usage"];
  model?: string;
};

/** Gemini-backed PathAdjuster: minimal-edit remediation for adjust_plan. */
export class GeminiPathAdjuster implements PathAdjuster {
  constructor(private readonly llm: LLMClient) {}

  // Best-effort telemetry; never breaks the adjustment.
  private async recordLlmCall(snapshot: TelemetrySnapshot): Promise<void> {
    try {
      const model = snapshot.model ?? TELEMETRY_MODEL;
      const inputTokens = snapshot.usage?.inputTokens ?? 0;
      const outputTokens = snapshot.usage?.outputTokens ?? 0;
      await prisma.llmCall.create({
        data: {
          purpose: "path_adjust",
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
        `[llm-telemetry] failed to persist path_adjust row: ${
          (err as Error).message
        }`,
      );
    }
  }

  private buildMessages(input: PathAdjusterInput) {
    const s = input.triggerScores;
    const content = [
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
      `--- The goalpost that triggered adjust_plan ---`,
      `Order: ${input.currentGoalpost.order}`,
      `Title: ${input.currentGoalpost.title}`,
      `Objective: ${input.currentGoalpost.objective}`,
      ``,
      `Trigger evaluation scores (0-4):`,
      `- recall: ${s.recall}`,
      `- application: ${s.application}`,
      `- conceptual: ${s.conceptual}`,
      `- transfer: ${s.transfer}`,
      `- communication: ${s.communication}`,
      `- coverage: ${s.coverage}`,
      ``,
      `Trigger rationale (why repeating won't help):`,
      input.triggerRationale || "(none provided)",
      ``,
      `--- Remaining goalposts (not yet completed, in order) ---`,
      ...(input.remainingGoalposts.length
        ? input.remainingGoalposts.map(
            (g) =>
              `- [order ${g.order}] ${g.title} — ${g.objective} (${g.estimatedMinutes} min)`,
          )
        : ["- (none remaining)"]),
      ``,
      input.mode === "remediation"
        ? `Produce the MINIMAL adjustment. Insert the prerequisite at order ${
            input.currentGoalpost.order + 1
          }. Keep >=70% of the remaining goalposts intact.`
        : `Produce the MINIMAL adjustment that resolves the learner's concern. Only ` +
          `insert a new goalpost, at order ${
            input.currentGoalpost.order + 1
          }, if the concern genuinely requires one. Keep >=70% of the remaining ` +
          `goalposts intact.`,
    ].join("\n");
    return [{ role: "user" as const, content }];
  }

  // Fold nullish step fields to defaults (sourceIds -> [], rubricFocus -> []) and
  // collapse steps into the generic { order, type, payload } GoalpostPlan step model.
  private toPathAdjustment(parsed: ParsedPathAdjustment): PathAdjustment {
    return {
      insertedGoalposts: parsed.insertedGoalposts.map((gp) => ({
        order: gp.order,
        title: gp.title,
        objective: gp.objective,
        estimatedMinutes: gp.estimatedMinutes,
        steps: gp.steps.map((step) =>
          step.type === "information"
            ? {
                order: step.order,
                type: step.type,
                // SKELETON ONLY (redesign §9): empty content keeps the step "not yet
                // generated" so the pipeline authors the LessonDoc on entry.
                payload: {
                  content: "",
                  sourceIds: step.sourceIds ?? [],
                },
              }
            : {
                order: step.order,
                type: step.type,
                payload: {
                  // superRefine on insertedStepSchema guarantees a non-empty
                  // prompt for every non-"information" step; the ?? "" only
                  // satisfies the flattened (nullish) TS type.
                  prompt: step.prompt ?? "",
                  rubricFocus: step.rubricFocus ?? [],
                },
              },
        ),
      })),
      removedOrders: parsed.removedOrders,
      modifiedGoalposts: parsed.modifiedGoalposts.map((m) => ({
        order: m.order,
        ...(m.title != null ? { title: m.title } : {}),
        ...(m.objective != null ? { objective: m.objective } : {}),
        ...(m.estimatedMinutes != null
          ? { estimatedMinutes: m.estimatedMinutes }
          : {}),
      })),
      rationale: parsed.rationale,
    };
  }

  async adjust(input: PathAdjusterInput): Promise<PathAdjustment> {
    const startedAt = Date.now();
    let usage: CompletionResult["usage"] | undefined;
    let usageModel: string | undefined;
    let parsed: ParsedPathAdjustment;
    const schema =
      input.mode === "remediation" ? remediationPathAdjustmentSchema : pathAdjustmentSchema;
    try {
      parsed = await this.llm.completeStructured({
        system: buildPathAdjusterSystem(input.mode),
        messages: this.buildMessages(input),
        temperature: 0.4,
        maxTokens: 4096,
        schema,
        schemaName: "PathAdjustment",
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

    return this.toPathAdjustment(parsed);
  }
}
