import type { z } from "zod";

export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

/**
 * Optional usage callback. completeStructured() returns only the parsed object,
 * so the provider's token usage would otherwise be lost. Clients invoke this
 * (best-effort, in a try/catch) with the real prompt/completion token counts and
 * the resolved model id so callers can record telemetry. Additive and optional:
 * existing callers are unaffected.
 */
export type UsageCallback = (
  usage: { inputTokens: number; outputTokens: number },
  model: string,
) => void;

export type CompletionOptions = {
  messages: Message[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  system?: string;
  onUsage?: UsageCallback;
};

export type CompletionResult = {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};

export type StructuredOptions<T> = CompletionOptions & {
  schema: z.ZodSchema<T>;
  schemaName: string;
  jsonSchema?: Record<string, unknown>;
};

export interface LLMClient {
  complete(opts: CompletionOptions): Promise<CompletionResult>;
  completeStructured<T>(opts: StructuredOptions<T>): Promise<T>;
}
