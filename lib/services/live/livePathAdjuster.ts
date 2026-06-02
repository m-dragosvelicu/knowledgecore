import { z } from "zod";
import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd } from "@/lib/llm";
import { prisma } from "@/lib/db";
import type {
  PathAdjuster,
  PathAdjusterInput,
  PathAdjustment,
} from "@/lib/services/types";

// gemini-3.5-flash is the live default for L0 services. Token usage is now
// surfaced from completeStructured via the optional onUsage callback (see
// lib/llm/types.ts); this constant is the fallback model id for telemetry when a
// failure short-circuits the call before any usage callback fires.
const TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

// =====================================================================
// Zod schema for PathAdjustment. Defined LOCALLY in this file (schemas.ts is
// owned by another engineer this wave) but mirrors lib/services/types.ts so
// the parsed output is structurally a PathAdjustment. The inserted-goalpost
// shape reuses the same step model the wizard persists: an information step
// (payload {content, sourceIds?}) plus one or more experience steps (payload
// {prompt, rubricFocus?}).
// =====================================================================

const rubricFocusSchema = z.enum([
  "recall",
  "application",
  "conceptual",
  "transfer",
  "communication",
  "coverage",
]);

// L1 — SKELETON ONLY (redesign §9). Inserted/revised remediation goalposts no
// longer carry authored information content: the two-phase pipeline overwrites it
// on entry, the same way it does for Call-A goalposts. The information step stays
// STRUCTURAL (order + type); `content` is dropped from the schema so the adjuster
// does not author lesson prose (a second ASCII-art surface). Sources still optional.
const insertedInformationStepSchema = z.object({
  order: z.number().int(),
  type: z.literal("information"),
  // Inserted remediation goalposts re-use already-cited sources; default empty.
  sourceIds: z.array(z.string()).nullish(),
});

const insertedExperienceStepSchema = z.object({
  order: z.number().int(),
  type: z.enum([
    "experience_socratic",
    "experience_applied_problem",
    "experience_mini_project",
  ]),
  prompt: z.string().min(1),
  rubricFocus: z.array(rubricFocusSchema).nullish(),
});

const insertedStepSchema = z.union([
  insertedInformationStepSchema,
  insertedExperienceStepSchema,
]);

const insertedGoalpostSchema = z
  .object({
    order: z.number().int(),
    title: z.string().min(1),
    objective: z.string().min(1),
    // Inserted goalposts must be a digestible remediation slice: 20-120 minutes.
    estimatedMinutes: z.number().int().min(20).max(120),
    steps: z.array(insertedStepSchema).min(2),
  })
  // At least one information + one experience step per inserted goalpost.
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

export const pathAdjustmentSchema = z.object({
  insertedGoalposts: z.array(insertedGoalpostSchema),
  removedOrders: z.array(z.number().int()),
  modifiedGoalposts: z.array(modifiedGoalpostSchema),
  rationale: z.string().min(1),
});

type ParsedPathAdjustment = z.infer<typeof pathAdjustmentSchema>;

// =====================================================================
// System prompt — the adjust_plan branch of the M6 remediation loop (L0.md
// §5 "Path Adjuster" row + §7). MINIMAL-EDIT is the load-bearing instruction.
// =====================================================================

const SYSTEM = `You are the PATH ADJUSTER of an AI learning platform. A learner
hit a goalpost they could not pass by repeating it: the checkpoint evaluator
returned "adjust_plan", meaning the artifact revealed a MISSING PREREQUISITE, so
the plan itself — not the learner's effort — needs to change. You decide the
SMALLEST edit to the remaining (not-yet-completed) path that gives them the
prerequisite they are missing, then lets them continue.

MINIMAL-EDIT PRINCIPLE (this is the most important rule):
- STRONGLY PREFER inserting 1, at most 2, short remediation goalposts that
  supply the missing prerequisite over rewriting the path.
- You MUST keep at least 70% of the remaining goalposts intact and unchanged.
  Removing or modifying more than 30% of them is only allowed when the trigger
  evaluation EXPLICITLY invalidates that material (e.g. the rationale shows a
  whole branch rests on a misconception). If in doubt, leave a goalpost alone.
- Default to: insertedGoalposts = [one short goalpost], removedOrders = [],
  modifiedGoalposts = []. Only deviate with clear justification from the trigger.
- Do NOT rewrite the tail of the path. Do NOT re-plan goalposts the learner can
  still reasonably reach. Touch as little as possible.

The trigger evaluation (scores + rationale) and the current goalpost tell you
WHY the plan stalled — use them to target the prerequisite precisely. Insert the
remediation goalpost so it comes RIGHT BEFORE the learner re-attempts: use
"order" = currentGoalpost.order + 1 (the remaining goalposts shift down).

EACH inserted goalpost must have:
- "order": the insertion point (>= currentGoalpost.order + 1).
- "title" and "objective": specific to the missing prerequisite, not generic.
- "estimatedMinutes": a realistic estimate, between 20 and 120.
- "steps": at least ONE information step AND at least ONE experience step.
  * information step: { order, type: "information" } only. This is a STRUCTURAL
    placeholder — do NOT write any lesson text. A separate lesson-authoring step
    writes the explainer (targeting the missing prerequisite) later, when the
    learner reaches the inserted goalpost.
  * experience step: { order, type, prompt, rubricFocus }. Pick the type:
    - experience_socratic: explain/reason in their own words
    - experience_applied_problem: solve a concrete problem and show their work
    - experience_mini_project: build a small artifact
    Choose a low-stakes task that confirms the prerequisite is now in place;
    favour a Socratic re-explanation over another mechanical drill. rubricFocus
    lists the targeted dimensions from: recall, application, conceptual,
    transfer, communication, coverage. Number information order 1, experience 2.

"removedOrders": orders of remaining goalposts to DROP (usually empty).
"modifiedGoalposts": light touch-ups to remaining goalposts ({ order, and any of
title/objective/estimatedMinutes }) — usually empty; use only to re-aim a
goalpost that now depends on the inserted prerequisite.

"rationale" — VOICE: ONE warm sentence written in the SECOND PERSON, spoken
DIRECTLY to the learner as "you" (L0.md §7 Q7 acknowledge notice). It tells them,
gently, that you have added a short step to shore up what tripped them up so the
next step rests on solid ground. Never say "the learner", never use their name,
never narrate about them in the third person. Reassuring, not clinical.`;

type TelemetrySnapshot = {
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  // Real token usage captured from the LLM client's onUsage callback. Absent
  // only when the call failed before the provider returned usage metadata.
  usage?: CompletionResult["usage"];
  // Provider-reported model id from the same callback; falls back to
  // TELEMETRY_MODEL when usage never fired.
  model?: string;
};

export class LivePathAdjuster implements PathAdjuster {
  constructor(private readonly llm: LLMClient) {}

  /**
   * Best-effort per-call telemetry. Wrapped in try/catch so a logging failure
   * can never break the adjustment.
   */
  private async recordLlmCall(snapshot: TelemetrySnapshot): Promise<void> {
    try {
      const model = snapshot.model ?? TELEMETRY_MODEL;
      const inputTokens = snapshot.usage?.inputTokens ?? 0;
      const outputTokens = snapshot.usage?.outputTokens ?? 0;
      await prisma.llmCall.create({
        data: {
          // L1: dedicated `path_adjust` purpose now exists (was the documented
          // L0 stopgap that logged adjust_plan calls under `other`).
          purpose: "path_adjust",
          model,
          inputTokens,
          outputTokens,
          // 0 only when the model is absent from the pricing table; tokens stay real.
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
      `Produce the MINIMAL adjustment. Insert the prerequisite at order ${
        input.currentGoalpost.order + 1
      }. Keep >=70% of the remaining goalposts intact.`,
    ].join("\n");
    return [{ role: "user" as const, content }];
  }

  /**
   * Normalize the parsed result into the PathAdjustment shape lib/services
   * consumers expect: nullish step fields fold to the documented defaults
   * (sourceIds -> [], rubricFocus -> []) and steps collapse into the generic
   * { order, type, payload } GoalpostPlan step model.
   */
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
                // SKELETON ONLY (redesign §9): the adjuster no longer authors
                // lesson prose. Empty content + no contentGeneratedAt keeps the
                // step "not yet generated", so the two-phase pipeline fills the
                // real LessonDoc when the learner enters this inserted goalpost.
                payload: {
                  content: "",
                  sourceIds: step.sourceIds ?? [],
                },
              }
            : {
                order: step.order,
                type: step.type,
                payload: {
                  prompt: step.prompt,
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
    try {
      parsed = await this.llm.completeStructured({
        system: SYSTEM,
        messages: this.buildMessages(input),
        temperature: 0.4,
        maxTokens: 4096,
        schema: pathAdjustmentSchema,
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
