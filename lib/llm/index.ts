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
  // Live L0 services run on Google Gemini (gemini-3.5-flash). The Anthropic and
  // Paralon clients remain available for other call sites but are not the default.
  return new GeminiClient();
}
