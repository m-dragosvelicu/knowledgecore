import { AnthropicClient } from "./anthropic";
import { GeminiClient } from "./gemini";
import { ParalonClient } from "./paralon";
import type { LLMClient } from "./types";

export type {
  Message,
  CompletionOptions,
  CompletionResult,
  StructuredOptions,
  UsageCallback,
  LLMClient,
  TranscriptionClient,
  TranscriptionOptions,
  TranscriptionResult,
} from "./types";

export { computeCostMicroUsd } from "./pricing";
export {
  withLlmTelemetryContext,
  getLlmTelemetryContext,
  type LlmTelemetryContext,
} from "./telemetryContext";

export { AnthropicClient } from "./anthropic";
export { GeminiClient } from "./gemini";
export { ParalonClient } from "./paralon";

export function getDefaultClient(): LLMClient {
  // L0 services run on Google Gemini (gemini-3.5-flash). The Anthropic and
  // Paralon clients remain available for other call sites but are not the default.
  return new GeminiClient();
}

/**
 * L1 Slice 3 — the default AUDIO transcription provider. Gemini is the only
 * client that implements TranscriptionClient (the Anthropic/Paralon clients are
 * text-only here), so this returns the same Gemini client typed for transcription.
 */
export function getDefaultTranscriptionClient(): import("./types").TranscriptionClient {
  return new GeminiClient();
}
