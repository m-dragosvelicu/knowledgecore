import { z } from "zod";
import type {
  CompletionOptions,
  CompletionResult,
  LLMClient,
  Message,
  StructuredOptions,
} from "./types";

const DEFAULT_BASE_URL = "https://paraloncloud.com/v1";
const DEFAULT_MODEL = "qwen3-8b";
const DEFAULT_MAX_TOKENS = 4096;

function zodToJsonSchema(schema: z.ZodSchema<unknown>): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodNodeToJson(value);
      if (!value.isOptional()) required.push(key);
    }
    return { type: "object", properties, required, additionalProperties: false };
  }
  return zodNodeToJson(schema as z.ZodTypeAny);
}

function zodNodeToJson(node: z.ZodTypeAny): Record<string, unknown> {
  if (node instanceof z.ZodOptional || node instanceof z.ZodNullable) {
    return zodNodeToJson(node.unwrap());
  }
  if (node instanceof z.ZodString) return { type: "string" };
  if (node instanceof z.ZodNumber) return { type: "number" };
  if (node instanceof z.ZodBoolean) return { type: "boolean" };
  if (node instanceof z.ZodArray) {
    return { type: "array", items: zodNodeToJson(node.element) };
  }
  if (node instanceof z.ZodEnum) {
    return { type: "string", enum: node.options };
  }
  if (node instanceof z.ZodObject) {
    return zodToJsonSchema(node);
  }
  return {};
}

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
};

function mapMessages(messages: Message[], system?: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  const sys = system ?? messages.find((m) => m.role === "system")?.content;
  if (sys) out.push({ role: "system", content: sys });
  for (const m of messages) {
    if (m.role === "system") continue;
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

// Qwen3 models emit reasoning inside <think>...</think> blocks in the
// content stream. Strip them so callers see the final answer only.
function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
}

type ParalonChatResponse = {
  model: string;
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

export class ParalonClient implements LLMClient {
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(
    apiKey?: string,
    defaultModel: string = DEFAULT_MODEL,
    baseUrl: string = DEFAULT_BASE_URL,
  ) {
    const key = apiKey ?? process.env.PARALON_API_KEY;
    if (!key) throw new Error("PARALON_API_KEY is not set");
    this.apiKey = key;
    this.baseUrl = baseUrl;
    this.defaultModel = defaultModel;
  }

  private async post(body: Record<string, unknown>): Promise<ParalonChatResponse> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Paralon request failed (${res.status}): ${detail}`);
    }
    return (await res.json()) as ParalonChatResponse;
  }

  async complete(opts: CompletionOptions): Promise<CompletionResult> {
    const model = opts.model ?? this.defaultModel;
    const response = await this.post({
      model,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature,
      messages: mapMessages(opts.messages, opts.system),
    });
    const choice = response.choices[0];
    const raw = choice?.message.content ?? "";
    return {
      text: stripThinkBlocks(raw),
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      model: response.model,
    };
  }

  async completeStructured<T>(opts: StructuredOptions<T>): Promise<T> {
    const model = opts.model ?? this.defaultModel;
    const inputSchema = opts.jsonSchema ?? zodToJsonSchema(opts.schema);
    const response = await this.post({
      model,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature,
      messages: mapMessages(opts.messages, opts.system),
      tools: [
        {
          type: "function",
          function: {
            name: opts.schemaName,
            description: `Return a value matching the ${opts.schemaName} schema.`,
            parameters: inputSchema,
          },
        },
      ],
      tool_choice: {
        type: "function",
        function: { name: opts.schemaName },
      },
    });
    const call = response.choices[0]?.message.tool_calls?.[0];
    if (!call) {
      throw new Error("Paralon response did not include a tool_call");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.function.arguments);
    } catch {
      throw new Error(`Paralon returned invalid JSON for ${opts.schemaName}`);
    }
    return opts.schema.parse(parsed);
  }
}
