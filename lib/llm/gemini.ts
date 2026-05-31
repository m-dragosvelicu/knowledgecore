import { GoogleGenAI, FinishReason } from "@google/genai";
import type { GenerateContentConfig, GenerateContentResponse } from "@google/genai";
import { z } from "zod";
import type {
  CompletionOptions,
  CompletionResult,
  LLMClient,
  Message,
  StructuredOptions,
} from "./types";

// gemini-3.5-flash is live on the Generative Language API (v1beta) for this
// key and supports structured output (responseSchema). Verified returning 200
// from generateContent. Override via GEMINI_MODEL if needed.
const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

// ---------------------------------------------------------------------
// Thinking control + token floors
//
// gemini-3.5-flash is a THINKING model: reasoning ("thought") tokens are drawn
// from the SAME maxOutputTokens budget as the visible answer. On large prompts
// the thinking pass can consume most of the budget, truncating the JSON answer
// (finishReason MAX_TOKENS) so JSON.parse fails. This was the intermittent
// "did not return valid JSON" failure.
//
// The installed @google/genai is 0.7.0, whose `ThinkingConfig` type only
// declares `includeThoughts` -- it has NO `thinkingBudget` field, which is why
// the naive `thinkingConfig = { thinkingBudget: 512 }` failed to typecheck.
// However, the LIVE v1beta API for gemini-3.5-flash DOES honor `thinkingBudget`
// at the wire level (empirically verified: thinkingBudget:0 -> thoughtsTokenCount
// becomes undefined, i.e. thinking is disabled). We therefore declare the field
// in a local type that extends the SDK config so we can set it type-safely
// without an `any`/`never` cast over the whole config object.
//
// For a schema-constrained JUDGE (completeStructured), free-form chain-of-thought
// is unnecessary -- the model emits JSON conforming to responseSchema -- so we
// disable thinking there. This both fixes the truncation and cuts cost/latency.
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

// ---------------------------------------------------------------------
// Prompt caching (L1 Slice 1 tracked task)
//
// AS-BUILT STRATEGY: this client relies on Gemini's IMPLICIT prefix caching.
// gemini-2.5/3.x Flash automatically caches a repeated request prefix (here the
// invariant `systemInstruction` + `responseSchema`) and bills the cached prefix
// at a reduced rate on subsequent calls — with NO API plumbing required. Because
// every structured call sends the SAME stable system prompt for a given service
// (e.g. the lesson-content SYSTEM is a module constant), that prefix is already
// in the implicit-cache path. The `cacheKey` option (lib/llm/types.ts) documents
// the caller's invariant prefix so this remains true and is greppable.
//
// TRACKED TODO — EXPLICIT context-cache resources (`ai.caches.create`/`get`):
// the @google/genai Caches API exists in this SDK, but explicit context caching
// has a HARD MINIMUM cacheable token count (~1k–4k tokens depending on model).
// Our stable prefixes (system instruction + schema) are BELOW that minimum, so
// `caches.create` would be rejected for these prompts; it only pays off for very
// large shared prefixes (e.g. a big shared document corpus in L2/L3). Wiring the
// create/get/delete lifecycle + TTL management now would add cost and failure
// surface for no benefit on L1's small prefixes. Deferred deliberately; revisit
// when a large shared prefix appears (L2 Research/Library). Until then implicit
// caching covers the L1 spine. `cacheKey` is forwarded as the cache hint.
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

// =====================================================================
// Zod -> Gemini responseSchema converter
//
// The @google/genai SDK expects a Schema object with UPPERCASE type names
// ("OBJECT", "ARRAY", "STRING", "NUMBER", "INTEGER", "BOOLEAN") plus
// `properties`, `items`, `required`, `enum`, and `propertyOrdering`.
// We convert the existing Zod schemas so service code only has to declare
// its contract once (as Zod) and validate the result with the same schema.
// =====================================================================

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

function zodToGeminiSchema(schema: z.ZodTypeAny): GeminiSchema {
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

export class GeminiClient implements LLMClient {
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
}
