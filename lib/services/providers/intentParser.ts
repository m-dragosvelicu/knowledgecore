import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd } from "@/lib/llm";
import { prisma } from "@/lib/db";
import type { IntentParser, ParsedSubject } from "@/lib/services/types";
import { parsedSubjectSchema } from "./schemas";
import { INTENT_PARSER_SYSTEM } from "@/lib/llm/prompts/intentParserPrompts";

// Intent parsing is a tiny extraction task, so it runs on the cheapest
// structured-output Gemini tier (Flash-Lite) rather than the heavier
// gemini-3.5-flash used by generative L0 services. Overridable via
// GEMINI_INTENT_MODEL; this constant is only the telemetry fallback.
const INTENT_MODEL =
  process.env.GEMINI_INTENT_MODEL ?? "gemini-3.1-flash-lite";
const TELEMETRY_MODEL = INTENT_MODEL;

type TelemetrySnapshot = {
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  usage?: CompletionResult["usage"];
  model?: string;
};

/** Gemini-backed IntentParser: a single structured extraction call. */
export class GeminiIntentParser implements IntentParser {
  constructor(private readonly llm: LLMClient) {}

  /**
   * Best-effort per-call telemetry, mirroring the other providers. Wrapped
   * in try/catch so a logging failure can never break intent parsing.
   */
  private async recordLlmCall(snapshot: TelemetrySnapshot): Promise<void> {
    try {
      const model = snapshot.model ?? TELEMETRY_MODEL;
      const inputTokens = snapshot.usage?.inputTokens ?? 0;
      const outputTokens = snapshot.usage?.outputTokens ?? 0;
      await prisma.llmCall.create({
        data: {
          purpose: "intent_parse",
          model,
          inputTokens,
          outputTokens,
          costMicroUsd: computeCostMicroUsd(model, inputTokens, outputTokens),
          latencyMs: snapshot.latencyMs,
          success: snapshot.success,
          errorMessage: snapshot.errorMessage,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[llm-telemetry] failed to persist intent_parse row: ${
          (err as Error).message
        }`,
      );
    }
  }

  async parse(rawText: string): Promise<ParsedSubject> {
    const startedAt = Date.now();
    let usage: CompletionResult["usage"] | undefined;
    let usageModel: string | undefined;
    try {
      const raw = await this.llm.completeStructured({
        model: INTENT_MODEL,
        system: INTENT_PARSER_SYSTEM,
        messages: [
          {
            role: "user",
            content: `Learner's raw input: "${rawText}"\n\nReturn the canonical subject, scope note, and the ambiguity flag.`,
          },
        ],
        temperature: 0.2,
        schema: parsedSubjectSchema,
        schemaName: "ParsedSubject",
        onUsage: (u, m) => {
          usage = u;
          usageModel = m;
        },
      });
      await this.recordLlmCall({
        latencyMs: Date.now() - startedAt,
        success: true,
        errorMessage: null,
        usage,
        model: usageModel,
      });
      // Normalize the nullish ambiguity fields (Gemini emits false/null when the
      // intent is clear). A clarification is only meaningful when ambiguous.
      const ambiguous = raw.ambiguous ?? undefined;
      const result: ParsedSubject = {
        canonicalName: raw.canonicalName,
        scopeNote: raw.scopeNote,
        ambiguous,
        clarification: ambiguous ? (raw.clarification ?? undefined) : undefined,
      };
      return result;
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
  }
}
