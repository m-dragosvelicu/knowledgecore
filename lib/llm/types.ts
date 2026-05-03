import type { z } from "zod";

export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type CompletionOptions = {
  messages: Message[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  system?: string;
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
