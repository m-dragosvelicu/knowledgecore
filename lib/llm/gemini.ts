import { GoogleGenAI } from "@google/genai";
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
    // Gemini lacks a oneOf/anyOf. Collapse all-literal unions: string literals
    // become a STRING enum; numeric literals become an INTEGER. Otherwise fall
    // back to the first variant's schema.
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
    return zodToGeminiSchema(options[0]);
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
  // Records / unknown shapes: Gemini cannot represent open-ended maps well.
  // Fall back to a permissive object.
  return { type: "OBJECT" };
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
    const { contents, systemInstruction } = mapMessages(opts.messages);
    const system = opts.system ?? systemInstruction;
    const responseSchema =
      opts.jsonSchema ?? zodToGeminiSchema(opts.schema as unknown as z.ZodTypeAny);
    const response = await this.client.models.generateContent({
      model,
      contents,
      config: {
        maxOutputTokens: opts.maxTokens,
        temperature: opts.temperature,
        systemInstruction: system,
        responseMimeType: "application/json",
        responseSchema: responseSchema as never,
      },
    });
    const text = response.text ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Gemini did not return valid JSON for ${opts.schemaName}`);
    }
    return opts.schema.parse(parsed);
  }
}
