import { GoogleGenAI, FinishReason } from "@google/genai";
import type { GenerateContentConfig, GenerateContentResponse } from "@google/genai";
import { z } from "zod";
import type {
  CompletionOptions,
  CompletionResult,
  LLMClient,
  Message,
  StructuredOptions,
  TranscriptionClient,
  TranscriptionOptions,
  TranscriptionResult,
} from "./types";

// gemini-3.5-flash is live on the Generative Language API (v1beta) for this
// key and supports structured output (responseSchema). Verified returning 200
// from generateContent. Override via GEMINI_MODEL if needed.
const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

// L1 Slice 3 — AUDIO transcription model. Flash-class multimodal handles inline
// audio cheaply with competitive English WER (see CEO/stt-approach-2026.html).
// Defaults to the text model to reuse one provider/key; override with
// GEMINI_STT_MODEL for a dedicated audio model.
const DEFAULT_STT_MODEL =
  process.env.GEMINI_STT_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

// The transcription instruction. Kept terse and verbatim-biased: we want the
// learner's WORDS, not a summary or an answer, because the transcript may feed a
// graded checkpoint. The learner can still edit it before submitting.
function buildTranscriptionPrompt(languageHint: string | undefined): string {
  const lang = (languageHint ?? "en").trim() || "en";
  return [
    "Transcribe the spoken audio to text VERBATIM.",
    `The speaker is talking in ${lang === "en" || lang.startsWith("en") ? "English" : lang}.`,
    "Return ONLY the transcript text — no preamble, no quotation marks, no commentary,",
    "no speaker labels, no timestamps. Do not answer, summarise, translate, or correct",
    "the content; write down exactly what was said. If the audio is silent or",
    "unintelligible, return an empty string.",
  ].join(" ");
}

// gemini-3.5-flash is a THINKING model: reasoning tokens share maxOutputTokens
// with the visible answer, so large prompts can truncate the JSON (MAX_TOKENS)
// mid-parse -- the intermittent "did not return valid JSON" failure.
// @google/genai@0.7.0's ThinkingConfig type has no `thinkingBudget` field, but
// the live v1beta API honors it at the wire level (thinkingBudget:0 disables
// thinking, verified via thoughtsTokenCount) -- hence the local type extension
// below instead of an any/never cast. completeStructured disables thinking
// entirely: schema-constrained output needs no chain-of-thought, and it fixes
// the truncation and cuts cost/latency.
type ThinkingConfigWithBudget = {
  includeThoughts?: boolean;
  // tokens; 0 = thinking OFF, -1 = automatic. Honored by the live v1beta API
  // even though @google/genai@0.7.0 does not yet declare it in ThinkingConfig.
  thinkingBudget?: number;
};
type GenerateContentConfigWithThinking = GenerateContentConfig & {
  thinkingConfig?: ThinkingConfigWithBudget;
};

// Visible-output floor for structured calls. Even with thinking disabled, a
// large EvaluationResult (rationale + 6 verbatim evidence quotes) needs room.
const STRUCTURED_OUTPUT_TOKEN_FLOOR = 4096;

// Prompt caching (L1 Slice 1): relies on Gemini's implicit prefix caching --
// gemini-2.5/3.x Flash automatically caches a repeated request prefix (the
// invariant systemInstruction + responseSchema) at a reduced rate, no API
// plumbing needed. `cacheKey` (lib/llm/types.ts) just documents the caller's
// invariant prefix so this stays true.
//
// Explicit context-cache resources (ai.caches.create/get) are NOT wired: they
// have a hard minimum cacheable token count (~1k-4k) our small stable prefixes
// don't meet. Revisit if a large shared prefix appears (e.g. L2 Research/Library).
function noteCacheHint(_cacheKey: string | undefined): void {
  // Intentionally a no-op beyond documenting intent: implicit caching needs no
  // call-site action. Kept as an explicit seam so the explicit-cache TODO above
  // has a single place to hook in later.
}

/**
 * Best-effort token-usage extraction from a Gemini response. @google/genai@0.7.0
 * exposes usageMetadata.promptTokenCount / candidatesTokenCount. Reads them and
 * invokes opts.onUsage (if provided) with the resolved model id. Wrapped so a
 * malformed/absent usageMetadata can NEVER break the call; falls back to 0s.
 */
function reportUsage(
  response: GenerateContentResponse,
  model: string,
  onUsage: ((usage: { inputTokens: number; outputTokens: number }, model: string) => void) | undefined,
): void {
  if (!onUsage) return;
  try {
    const usage = response.usageMetadata;
    onUsage(
      {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
      },
      model,
    );
  } catch {
    // Telemetry extraction must never break the user path.
  }
}

// Zod -> Gemini responseSchema converter. The @google/genai SDK expects a
// Schema object with UPPERCASE type names (OBJECT/ARRAY/STRING/NUMBER/
// INTEGER/BOOLEAN) plus properties/items/required/enum/propertyOrdering.
// Converting from Zod lets service code declare its contract once and
// validate the result with the same schema.

type GeminiSchema = {
  type: string;
  description?: string;
  properties?: Record<string, GeminiSchema>;
  items?: GeminiSchema;
  required?: string[];
  enum?: string[];
  propertyOrdering?: string[];
  nullable?: boolean;
};

export function zodToGeminiSchema(schema: z.ZodTypeAny): GeminiSchema {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    const inner = zodToGeminiSchema(schema.unwrap());
    return { ...inner, nullable: true };
  }
  if (schema instanceof z.ZodDefault) {
    return zodToGeminiSchema(schema._def.innerType as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodEffects) {
    return zodToGeminiSchema(schema._def.schema as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodString) {
    return { type: "STRING" };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: "NUMBER" };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: "BOOLEAN" };
  }
  if (schema instanceof z.ZodLiteral) {
    const value = schema._def.value;
    if (typeof value === "string") return { type: "STRING", enum: [value] };
    if (typeof value === "number") return { type: "NUMBER" };
    if (typeof value === "boolean") return { type: "BOOLEAN" };
    return { type: "STRING" };
  }
  if (schema instanceof z.ZodEnum) {
    return { type: "STRING", enum: schema.options as string[] };
  }
  if (schema instanceof z.ZodNativeEnum) {
    const values = Object.values(schema.enum).filter(
      (v) => typeof v === "string",
    ) as string[];
    return { type: "STRING", enum: values };
  }
  if (schema instanceof z.ZodUnion) {
    // Gemini lacks a oneOf/anyOf. We can only faithfully represent all-literal
    // unions: string literals become a STRING enum; numeric literals become an
    // INTEGER. Any other union (mixed, or non-literal variants) cannot be
    // expressed without silently dropping variants -- which would let Gemini
    // emit data that then fails the downstream Zod .parse. Fail loudly instead.
    const options = schema._def.options as z.ZodTypeAny[];
    const literals = options.filter((o) => o instanceof z.ZodLiteral);
    if (literals.length === options.length && literals.length > 0) {
      const values = literals.map((l) => (l as z.ZodLiteral<unknown>)._def.value);
      if (values.every((v) => typeof v === "string")) {
        return { type: "STRING", enum: values as string[] };
      }
      if (values.every((v) => typeof v === "number")) {
        return { type: "INTEGER" };
      }
    }
    throw new Error(
      "zodToGeminiSchema: cannot represent a non-literal or mixed-type union as " +
        "a Gemini responseSchema (Gemini has no oneOf/anyOf). Refactor the schema " +
        "to an all-string-literal or all-number-literal union, or pass an explicit " +
        "jsonSchema.",
    );
  }
  if (schema instanceof z.ZodArray) {
    return { type: "ARRAY", items: zodToGeminiSchema(schema.element) };
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, GeminiSchema> = {};
    const required: string[] = [];
    const ordering: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToGeminiSchema(value);
      ordering.push(key);
      if (!value.isOptional()) required.push(key);
    }
    return {
      type: "OBJECT",
      properties,
      required,
      propertyOrdering: ordering,
    };
  }
  // Records / unknown / any and every other unhandled shape: Gemini cannot
  // represent an open-ended map. The previous behavior returned a bare
  // { type: "OBJECT" } with no properties, which Gemini may reject or which
  // silently drops every field. Fail loudly so the schema is fixed at the
  // source rather than producing a structured call that can't be satisfied.
  const typeName = (schema as { _def?: { typeName?: string } })._def?.typeName;
  throw new Error(
    `zodToGeminiSchema: unsupported Zod type${
      typeName ? ` (${typeName})` : ""
    } for a Gemini responseSchema. Open-ended maps (z.record), z.unknown, and ` +
      "z.any cannot be expressed; use a closed z.object, or pass an explicit jsonSchema.",
  );
}

type GeminiContent = {
  role: "user" | "model";
  parts: { text: string }[];
};

function mapMessages(messages: Message[]): {
  contents: GeminiContent[];
  systemInstruction?: string;
} {
  const systemFromMessages = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const contents: GeminiContent[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  return {
    contents,
    systemInstruction: systemFromMessages || undefined,
  };
}

// finishReasons that indicate the candidate is genuinely unusable (vs. a clean
// STOP or a tolerable MAX_TOKENS that may still hold parseable text).
const HARD_BLOCK_REASONS: ReadonlySet<FinishReason> = new Set([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
]);

/**
 * Pull the visible text out of a response while surfacing problems instead of
 * silently returning "". Distinguishes: hard content blocks (never retry),
 * truncation (MAX_TOKENS), and empty/missing candidates (transient -> retry).
 */
function extractText(
  response: GenerateContentResponse,
  context: string,
): { text: string; truncated: boolean } {
  const candidate = response.candidates?.[0];
  const finishReason = candidate?.finishReason;

  if (finishReason && HARD_BLOCK_REASONS.has(finishReason)) {
    throw new GeminiBlockedError(
      `Gemini blocked the response for ${context} (finishReason=${finishReason}` +
        `${candidate?.finishMessage ? `: ${candidate.finishMessage}` : ""}).`,
    );
  }
  const promptBlock = response.promptFeedback?.blockReason;
  if (promptBlock) {
    throw new GeminiBlockedError(
      `Gemini blocked the prompt for ${context} (blockReason=${promptBlock}).`,
    );
  }

  const text = response.text ?? "";
  const truncated = finishReason === FinishReason.MAX_TOKENS;
  if (text.length === 0) {
    // No usable candidate text and not a hard block -> transient/empty.
    throw new GeminiEmptyError(
      `Gemini returned no text for ${context} (finishReason=${finishReason ?? "none"}).`,
    );
  }
  return { text, truncated };
}

/** A content/safety block. Deterministic -> not worth retrying. */
class GeminiBlockedError extends Error {}
/** Empty or missing candidate. Often transient -> safe to retry once. */
class GeminiEmptyError extends Error {}

export class GeminiClient implements LLMClient, TranscriptionClient {
  private client: GoogleGenAI;
  private defaultModel: string;

  constructor(apiKey?: string, defaultModel: string = DEFAULT_MODEL) {
    const key = apiKey ?? process.env.GOOGLE_GENAI_API_KEY;
    if (!key) throw new Error("GOOGLE_GENAI_API_KEY is not set");
    this.client = new GoogleGenAI({ apiKey: key });
    this.defaultModel = defaultModel;
  }

  async complete(opts: CompletionOptions): Promise<CompletionResult> {
    const model = opts.model ?? this.defaultModel;
    noteCacheHint(opts.cacheKey);
    const { contents, systemInstruction } = mapMessages(opts.messages);
    const system = opts.system ?? systemInstruction;
    const response = await this.client.models.generateContent({
      model,
      contents,
      config: {
        maxOutputTokens: opts.maxTokens,
        temperature: opts.temperature,
        systemInstruction: system,
      },
    });
    const text = response.text ?? "";
    const usage = response.usageMetadata;
    reportUsage(response, model, opts.onUsage);
    return {
      text,
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
      },
      model,
    };
  }

  async completeStructured<T>(opts: StructuredOptions<T>): Promise<T> {
    const model = opts.model ?? this.defaultModel;
    noteCacheHint(opts.cacheKey);
    const { contents, systemInstruction } = mapMessages(opts.messages);
    const system = opts.system ?? systemInstruction;
    const responseSchema =
      opts.jsonSchema ?? zodToGeminiSchema(opts.schema as unknown as z.ZodTypeAny);

    // Disable thinking for schema-constrained output and guarantee a visible
    // output budget large enough for the full JSON object. See the notes on
    // ThinkingConfigWithBudget / STRUCTURED_OUTPUT_TOKEN_FLOOR above.
    const maxOutputTokens = Math.max(
      opts.maxTokens ?? 0,
      STRUCTURED_OUTPUT_TOKEN_FLOOR,
    );
    const config: GenerateContentConfigWithThinking = {
      maxOutputTokens,
      temperature: opts.temperature,
      systemInstruction: system,
      responseMimeType: "application/json",
      responseSchema: responseSchema as never,
      thinkingConfig: { thinkingBudget: 0 },
    };

    const callOnce = async (): Promise<string> => {
      const response = await this.client.models.generateContent({
        model,
        contents,
        config,
      });
      const { text, truncated } = extractText(response, opts.schemaName);
      if (truncated) {
        // Report usage even on truncation: the tokens were still consumed.
        reportUsage(response, model, opts.onUsage);
        throw new GeminiEmptyError(
          `Gemini truncated the JSON for ${opts.schemaName} (finishReason=MAX_TOKENS, ` +
            `maxOutputTokens=${maxOutputTokens}); output is incomplete.`,
        );
      }
      reportUsage(response, model, opts.onUsage);
      return text;
    };

    // One retry on transient/empty/truncated outcomes; never retry hard blocks.
    let text: string;
    try {
      text = await callOnce();
    } catch (err) {
      if (err instanceof GeminiBlockedError) throw err;
      text = await callOnce();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const snippet = text.slice(0, 200).replace(/\s+/g, " ");
      throw new Error(
        `Gemini did not return valid JSON for ${opts.schemaName}. ` +
          `First 200 chars: ${snippet}`,
      );
    }
    return opts.schema.parse(parsed);
  }

  // L1 Slice 3 — AUDIO transcription. Sends the recorded audio inline to Gemini
  // alongside a verbatim-transcription instruction. Audio is held in memory
  // only for this call and never persisted; reuses the same usage-extraction +
  // onUsage telemetry path as text completions.
  async transcribe(opts: TranscriptionOptions): Promise<TranscriptionResult> {
    const model = opts.model ?? DEFAULT_STT_MODEL;

    // @google/genai expects base64 for inline bytes. Encode in a Buffer (Node
    // server route) without pulling in a dependency.
    const base64 = Buffer.from(opts.audio).toString("base64");

    const response = await this.client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: base64, mimeType: opts.mimeType } },
            { text: buildTranscriptionPrompt(opts.languageHint) },
          ],
        },
      ],
      config: {
        // Transcription is not schema-constrained; keep thinking off for speed
        // and a tight transcript, and give a generous text budget.
        temperature: 0,
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: 0 },
      } as GenerateContentConfigWithThinking,
    });

    // extractText surfaces hard content blocks / empty candidates as errors,
    // exactly like the text path. A clean silent recording legitimately yields
    // empty text, so tolerate empty here rather than throwing.
    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason;
    if (finishReason && HARD_BLOCK_REASONS.has(finishReason)) {
      throw new GeminiBlockedError(
        `Gemini blocked the audio transcription (finishReason=${finishReason}).`,
      );
    }
    const text = (response.text ?? "").trim();

    const usage = response.usageMetadata;
    reportUsage(response, model, opts.onUsage);
    return {
      text,
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
      },
      model,
    };
  }
}
