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
  /**
   * L1 — prompt-caching hint. A stable identifier for the INVARIANT prefix of
   * this call (typically the system instruction). When set, the client may reuse
   * a cached prefix across calls that share the same key, so only the per-call
   * (per-learner) tail is billed/processed at full cost. Callers MUST keep the
   * keyed prefix constant for a given key. Optional and additive: clients that do
   * not implement caching ignore it with no behaviour change. See the Gemini
   * client for the as-built caching strategy (implicit prefix caching today;
   * explicit context-cache resources are a tracked TODO).
   */
  cacheKey?: string;
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
