import { z } from "zod";
import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd } from "@/lib/llm";
import { prisma } from "@/lib/db";
import type {
  OutcomeRevisionInput,
  OutcomeRevisionResult,
} from "@/lib/services/outcomeRevision";
import type { OutcomeReviser } from "@/lib/services/interfaces/outcomeReviser.interface";
import { canDoStatementSchema } from "./shared.schemas";
import { OUTCOME_REVISER_SYSTEM } from "@/lib/llm/prompts/outcomeReviserPrompts";

// gemini-3.5-flash is the live default for L0/L1 generative services. Fallback
// model id for telemetry when a failure short-circuits before onUsage fires.
const TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

const outcomeRevisionSchema = z.object({
  canonicalName: z.string().min(1),
  scopeNote: z.string().min(1),
  canDoStatements: z.array(canDoStatementSchema).min(1),
  successCriterion: z.string().min(1),
  acknowledgment: z.string().min(1),
});

type TelemetrySnapshot = {
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  usage?: CompletionResult["usage"];
  model?: string;
};

/** Gemini-backed OutcomeReviser: single-shot, targeted rewrite. */
export class GeminiOutcomeReviser implements OutcomeReviser {
  constructor(private readonly llm: LLMClient) {}

  // Best-effort telemetry; mirrors the other Gemini-backed services. Never
  // breaks the revision on a logging failure.
  private async recordLlmCall(snapshot: TelemetrySnapshot): Promise<void> {
    try {
      const model = snapshot.model ?? TELEMETRY_MODEL;
      const inputTokens = snapshot.usage?.inputTokens ?? 0;
      const outputTokens = snapshot.usage?.outputTokens ?? 0;
      await prisma.llmCall.create({
        data: {
          purpose: "outcome_revision",
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
        `[llm-telemetry] failed to persist outcome_revision row: ${
          (err as Error).message
        }`,
      );
    }
  }

  private buildMessages(input: OutcomeRevisionInput) {
    const content = [
      `--- Current outcome ---`,
      `Subject: ${input.subject.canonicalName}`,
      `Scope: ${input.subject.scopeNote}`,
      `Success criterion: ${input.successCriterion}`,
      `Can-do statements:`,
      ...input.canDoStatements.map((s) => `- (${s.bloomLevel}) ${s.text}`),
      ``,
      `--- Learner's feedback ---`,
      input.feedback,
      ``,
      `Revise the outcome per the rules above.`,
    ].join("\n");
    return [{ role: "user" as const, content }];
  }

  async revise(input: OutcomeRevisionInput): Promise<OutcomeRevisionResult> {
    const startedAt = Date.now();
    let usage: CompletionResult["usage"] | undefined;
    let usageModel: string | undefined;
    let raw: z.infer<typeof outcomeRevisionSchema>;
    try {
      raw = await this.llm.completeStructured({
        system: OUTCOME_REVISER_SYSTEM,
        messages: this.buildMessages(input),
        temperature: 0.4,
        maxTokens: 1024,
        schema: outcomeRevisionSchema,
        schemaName: "OutcomeRevision",
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
      subject: {
        canonicalName: raw.canonicalName,
        scopeNote: raw.scopeNote,
      },
      canDoStatements: raw.canDoStatements,
      successCriterion: raw.successCriterion,
      acknowledgment: raw.acknowledgment,
    };
  }
}
