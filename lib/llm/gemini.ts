import { GoogleGenAI } from "@google/genai";
import type {
  CompletionOptions,
  CompletionResult,
  LLMClient,
  Message,
  StructuredOptions,
} from "./types";

const DEFAULT_MODEL = "gemini-2.0-flash-001";

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
    const response = await this.client.models.generateContent({
      model,
      contents,
      config: {
        maxOutputTokens: opts.maxTokens,
        temperature: opts.temperature,
        systemInstruction: system,
        responseMimeType: "application/json",
        responseSchema: opts.jsonSchema as never,
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
