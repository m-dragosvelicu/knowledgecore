import { AnthropicClient } from "./anthropic";
import { GeminiClient } from "./gemini";
import { ParalonClient } from "./paralon";
import type { LLMClient } from "./types";

export type {
  Message,
  CompletionOptions,
  CompletionResult,
  StructuredOptions,
  LLMClient,
} from "./types";

export { AnthropicClient } from "./anthropic";
export { GeminiClient } from "./gemini";
export { ParalonClient } from "./paralon";

export function getDefaultClient(): LLMClient {
  return new AnthropicClient();
}
