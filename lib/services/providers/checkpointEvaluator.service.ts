import { z } from "zod";
import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd, getLlmTelemetryContext } from "@/lib/llm";
import { prisma } from "@/lib/db";
import type {
  EvaluationResult,
  EvaluatorInput,
  EvidenceQuote,
} from "@/lib/services/types";
import type { CheckpointEvaluator } from "@/lib/services/interfaces/checkpointEvaluator.interface";
import { rubricLevelSchema } from "./shared.schemas";
import { CHECKPOINT_EVALUATOR_SYSTEM } from "@/lib/llm/prompts/checkpointEvaluatorPrompts";
// normalize/findVerbatim/NO_EVIDENCE live in verbatim.ts so offline analyses can
// reuse the exact production matcher without importing this Prisma-backed module.
import { findVerbatim, NO_EVIDENCE } from "./verbatim";

const rubricScoresSchema = z.object({
  recall: rubricLevelSchema,
  application: rubricLevelSchema,
  conceptual: rubricLevelSchema,
  transfer: rubricLevelSchema,
  communication: rubricLevelSchema,
  coverage: rubricLevelSchema,
});

const dimensionSchema = z.enum([
  "recall",
  "application",
  "conceptual",
  "transfer",
  "communication",
  "coverage",
]);

const evidenceQuoteSchema = z.object({
  dimension: dimensionSchema,
  quote: z.string(),
});

const decisionSchema = z.enum(["advance", "repeat", "adjust_plan"]);

const evaluationResultSchema = z.object({
  scores: rubricScoresSchema,
  evidence: z.array(evidenceQuoteSchema).min(1),
  decision: decisionSchema,
  rationale: z.string().min(1),
});

// gemini-3.5-flash is the live default. Token usage is surfaced from
// completeStructured via the onUsage callback (lib/llm/types.ts); this
// constant is only the telemetry fallback when a failure fires before usage.
const TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

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

/** Gemini-backed CheckpointEvaluator: rubric scoring + verbatim-quote repair. */
export class GeminiCheckpointEvaluator implements CheckpointEvaluator {
  constructor(private readonly llm: LLMClient) {}

  /**
   * Best-effort per-call telemetry. Wrapped in try/catch by the caller so a
   * logging failure can never break evaluation. evaluationId may be null because
   * the CheckpointEvaluation row often does not exist yet at eval time.
   */
  private async recordLlmCall(snapshot: TelemetrySnapshot): Promise<void> {
    try {
      const model = snapshot.model ?? TELEMETRY_MODEL;
      const inputTokens = snapshot.usage?.inputTokens ?? 0;
      const outputTokens = snapshot.usage?.outputTokens ?? 0;
      const ctx = getLlmTelemetryContext();
      await prisma.llmCall.create({
        data: {
          purpose: "checkpoint_evaluate",
          model,
          inputTokens,
          outputTokens,
          // 0 only when the model is absent from the pricing table; tokens stay real.
          costMicroUsd: computeCostMicroUsd(model, inputTokens, outputTokens),
          latencyMs: snapshot.latencyMs,
          success: snapshot.success,
          errorMessage: snapshot.errorMessage,
          evaluationId: null,
          userId: ctx?.userId ?? null,
          intentId: ctx?.intentId ?? null,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[llm-telemetry] failed to persist checkpoint_evaluate row: ${
          (err as Error).message
        }`,
      );
    }
  }

  private buildMessages(input: EvaluatorInput, repairNote?: string) {
    const base = [
      `Goalpost: ${input.goalpostTitle}`,
      `Objective: ${input.goalpostObjective}`,
      `Attempt number: ${input.attempt}`,
      ``,
      `--- Information the learner was given ---`,
      input.informationContent || "(none)",
      ``,
      `--- Experience prompt ---`,
      input.experiencePrompt || "(none)",
      ``,
      `--- Learner's artifact (quote ONLY from here, verbatim) ---`,
      input.userArtifact || "(empty)",
      ``,
      `Evaluate now.`,
    ];
    if (repairNote) base.push("", repairNote);
    return [{ role: "user" as const, content: base.join("\n") }];
  }

  async evaluate(input: EvaluatorInput): Promise<EvaluationResult> {
    const artifact = input.userArtifact ?? "";

    const startedAt = Date.now();
    let usage: CompletionResult["usage"] | undefined;
    let usageModel: string | undefined;
    let result: EvaluationResult;
    try {
      result = await this.llm.completeStructured({
        system: CHECKPOINT_EVALUATOR_SYSTEM,
        messages: this.buildMessages(input),
        temperature: 0.2,
        maxTokens: 2048,
        schema: evaluationResultSchema,
        schemaName: "EvaluationResult",
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

    const verified = this.verifyEvidence(artifact, result.evidence);

    if (verified.unverifiedDimensions.length === 0) {
      return { ...result, evidence: verified.evidence };
    }

    // One repair attempt: ask the model to re-quote ONLY the failing dimensions
    // exactly. Keep the original scores/decision/rationale.
    const repairNote = [
      `Your previous evidence quotes for these dimensions were NOT verbatim`,
      `substrings of the learner's artifact: ${verified.unverifiedDimensions.join(", ")}.`,
      `Re-quote EXACTLY from the artifact for every dimension, copying a real`,
      `span character-for-character. Do not change your scores or decision.`,
    ].join(" ");

    let repaired: EvaluationResult | null = null;
    const repairStartedAt = Date.now();
    let repairUsage: CompletionResult["usage"] | undefined;
    let repairUsageModel: string | undefined;
    try {
      repaired = await this.llm.completeStructured({
        system: CHECKPOINT_EVALUATOR_SYSTEM,
        messages: this.buildMessages(input, repairNote),
        temperature: 0,
        maxTokens: 2048,
        schema: evaluationResultSchema,
        schemaName: "EvaluationResult",
        onUsage: (u, m) => {
          repairUsage = u;
          repairUsageModel = m;
        },
      });
      await this.recordLlmCall({
        latencyMs: Date.now() - repairStartedAt,
        success: true,
        errorMessage: null,
        usage: repairUsage,
        model: repairUsageModel,
      });
    } catch (err) {
      await this.recordLlmCall({
        latencyMs: Date.now() - repairStartedAt,
        success: false,
        errorMessage: (err as Error).message,
        usage: repairUsage,
        model: repairUsageModel,
      });
      // eslint-disable-next-line no-console
      console.warn(
        `[verbatim-guard] repair attempt failed to parse; degrading gracefully: ${
          (err as Error).message
        }`,
      );
    }

    if (repaired) {
      const reVerified = this.verifyEvidence(artifact, repaired.evidence);
      if (reVerified.unverifiedDimensions.length === 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[verbatim-guard] repair succeeded for dimensions: ${verified.unverifiedDimensions.join(
            ", ",
          )}`,
        );
        // Keep original scores/decision/rationale; take repaired verified quotes.
        return { ...result, evidence: reVerified.evidence };
      }
      // Merge: prefer whichever pass verified each quote.
      const merged = this.verifyEvidence(artifact, [
        ...repaired.evidence,
        ...result.evidence,
      ]);
      // eslint-disable-next-line no-console
      console.warn(
        `[verbatim-guard] repair partial; dimensions still unverified: ${merged.unverifiedDimensions.join(
          ", ",
        )} (flagged, scores kept)`,
      );
      return { ...result, evidence: merged.evidence };
    }

    // eslint-disable-next-line no-console
    console.warn(
      `[verbatim-guard] degrading gracefully; dimensions flagged unverified: ${verified.unverifiedDimensions.join(
        ", ",
      )} (scores kept)`,
    );
    return { ...result, evidence: verified.evidence };
  }

  /**
   * Exactly one evidence entry per dimension: prefer the first quote that
   * verifies as a verbatim substring (returns the original-text span); a
   * legitimate "(no evidence in artifact)" also counts as resolved. If nothing
   * verifies, emit one best-effort quote flagged "[unverified] " and report
   * the dimension so the caller can degrade gracefully.
   */
  private verifyEvidence(
    artifact: string,
    evidence: EvidenceQuote[],
  ): { evidence: EvidenceQuote[]; unverifiedDimensions: string[] } {
    type Dimension = EvidenceQuote["dimension"];
    // Preserve first-seen dimension order.
    const order: Dimension[] = [];
    const resolved = new Map<Dimension, EvidenceQuote>(); // dimension -> verified entry
    const fallback = new Map<Dimension, string>(); // dimension -> first raw quote

    for (const e of evidence) {
      if (!order.includes(e.dimension)) order.push(e.dimension);
      if (resolved.has(e.dimension)) continue; // already verified; ignore extras

      const trimmed = e.quote.trim();

      // A model may legitimately report no evidence.
      if (trimmed === NO_EVIDENCE || trimmed.length === 0) {
        resolved.set(e.dimension, { dimension: e.dimension, quote: NO_EVIDENCE });
        continue;
      }

      const verbatim = findVerbatim(artifact, e.quote);
      if (verbatim) {
        resolved.set(e.dimension, { dimension: e.dimension, quote: verbatim });
      } else if (!fallback.has(e.dimension)) {
        fallback.set(e.dimension, trimmed);
      }
    }

    const out: EvidenceQuote[] = [];
    const unverifiedDimensions: string[] = [];
    for (const dim of order) {
      const hit = resolved.get(dim);
      if (hit) {
        out.push(hit);
      } else {
        out.push({ dimension: dim, quote: `[unverified] ${fallback.get(dim) ?? ""}` });
        unverifiedDimensions.push(dim);
      }
    }

    return { evidence: out, unverifiedDimensions };
  }
}
