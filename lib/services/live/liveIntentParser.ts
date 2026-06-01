import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd } from "@/lib/llm";
import { prisma } from "@/lib/db";
import type { IntentParser, ParsedSubject } from "@/lib/services/types";
import { parsedSubjectSchema } from "./schemas";

// Intent parsing is a TINY extraction task (one short noun phrase + a one-line
// scope note), so it runs on the CHEAPEST structured-output-capable Gemini —
// the Flash-Lite tier — rather than the heavier gemini-3.5-flash used by the
// generative L0 services. Overridable via GEMINI_INTENT_MODEL. The resolved
// model id is surfaced from completeStructured via the optional onUsage callback
// (see lib/llm/types.ts); this constant is the fallback for telemetry when a
// failure short-circuits the call before any usage callback fires.
const INTENT_MODEL =
  process.env.GEMINI_INTENT_MODEL ?? "gemini-3.1-flash-lite";
const TELEMETRY_MODEL = INTENT_MODEL;

const SYSTEM = `You are the intake step of an AI learning platform. A learner has
typed, in their own words, what they want to learn. Your job is to EXTRACT the
subject they are after and turn it into a single clean canonical name plus a
short scope note.

- canonicalName: the concise subject NOUN PHRASE the learner is after. STRIP
  conversational lead-ins and framing such as "I want to learn about", "I'd like
  to understand", "teach me", "help me with", "how do I", "how does ... work",
  "can you explain". Keep ONLY the topic itself. Examples:
    - "I want to learn about the default mode network" -> "the default mode network"
    - "teach me stoicism for a bad day" -> "stoicism for a bad day"
    - "how does color actually work" -> "how color works"
  Use SENTENCE CASE: capitalize only the FIRST word and genuine proper nouns
  (names of people, places, named theories, languages, branded technologies —
  e.g. "French", "Art Nouveau", "React", "Python"). Do NOT Title-Case Every
  Word. Do not invent scope the learner did not imply.
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
        model: INTENT_MODEL,
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
