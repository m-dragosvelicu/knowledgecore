import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type {
  CompletionOptions,
  CompletionResult,
  LLMClient,
  Message,
  StructuredOptions,
} from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-6";
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

function mapMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));
}

export class AnthropicClient implements LLMClient {
  private client: Anthropic;
  private defaultModel: string;

  constructor(apiKey?: string, defaultModel: string = DEFAULT_MODEL) {
    const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    this.client = new Anthropic({ apiKey: key });
    this.defaultModel = defaultModel;
  }

  async complete(opts: CompletionOptions): Promise<CompletionResult> {
    const model = opts.model ?? this.defaultModel;
    const response = await this.client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature,
      system: opts.system,
      messages: mapMessages(opts.messages),
    });
    const block = response.content[0];
    const text = block && block.type === "text" ? block.text : "";
    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      model: response.model,
    };
  }

  async completeStructured<T>(opts: StructuredOptions<T>): Promise<T> {
    const model = opts.model ?? this.defaultModel;
    const inputSchema = opts.jsonSchema ?? zodToJsonSchema(opts.schema);
    const response = await this.client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: opts.temperature,
      system: opts.system,
      messages: mapMessages(opts.messages),
      tools: [
        {
          name: opts.schemaName,
          description: `Return a value matching the ${opts.schemaName} schema.`,
          input_schema: inputSchema as { type: "object"; [k: string]: unknown },
        },
      ],
      tool_choice: { type: "tool", name: opts.schemaName },
    });
    const block = response.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      throw new Error("Anthropic response did not include a tool_use block");
    }
    return opts.schema.parse(block.input);
  }
}
