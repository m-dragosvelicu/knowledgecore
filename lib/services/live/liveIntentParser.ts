import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd } from "@/lib/llm";
import { prisma } from "@/lib/db";
import type { IntentParser, ParsedSubject } from "@/lib/services/types";
import { parsedSubjectSchema } from "./schemas";

// gemini-3.5-flash is the live default for L0 services. The resolved model id is
// surfaced from completeStructured via the optional onUsage callback (see
// lib/llm/types.ts); this constant is the fallback for telemetry when a failure
// short-circuits the call before any usage callback fires.
const TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

const SYSTEM = `You are the intake step of an AI learning platform. A learner has
typed, in their own words, what they want to learn. Your job is to turn that raw
phrase into a single canonical subject and a short scope note.

- canonicalName: the standard, well-formed name of the subject (e.g. "Linear
  Algebra for Machine Learning", "Introductory French", "React Hooks"). Title
  case. Do not invent scope the learner did not imply.
- scopeNote: one short sentence estimating the breadth/level the learner seems to
  want (e.g. "Estimated scope: introductory, focused on practical application").

AMBIGUITY — CRITICAL (L0.md §3 Stage 2): you MUST surface ambiguity back to the
learner rather than silently narrowing it down to a guess. Set "ambiguous": true
and write a short "clarification" question when ANY of these hold:
- TOO VAGUE: the input does not name a real subject at all (e.g. "I want to learn
  stuff", "something useful", "things").
- TOO BROAD: the input names a whole field that cannot be a single learning
  journey (e.g. "physics", "math", "history", "programming", "business"). A
  focused journey needs a slice of it.
- TWO INTENTS IN ONE: the input bundles two distinct subjects (e.g. "Spanish and
  guitar", "calculus and also some chemistry").

When ambiguous, still fill canonicalName with your single best interpretation and
scopeNote as usual, but ALSO set ambiguous=true and make "clarification" a single
warm, concrete question that helps the learner narrow or pick (e.g. "Physics is a
big field — are you aiming at classical mechanics, electromagnetism, or something
more applied?"). When the input is clear and singular, set ambiguous=false and
leave clarification empty.`;

type TelemetrySnapshot = {
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  usage?: CompletionResult["usage"];
  model?: string;
};

export class LiveIntentParser implements IntentParser {
  constructor(private readonly llm: LLMClient) {}

  /**
   * Best-effort per-call telemetry, mirroring the other live services. Wrapped
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
        system: SYSTEM,
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
