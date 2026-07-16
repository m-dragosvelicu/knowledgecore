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
   * Prompt-caching hint: stable id for this call's invariant prefix (typically
   * the system instruction). Callers MUST keep the keyed prefix constant for a
   * given key; clients may then reuse a cached prefix so only the per-call tail
   * is billed at full cost. Optional/additive -- ignored by clients that don't
   * implement caching. See the Gemini client for the as-built strategy.
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

// L1 Slice 3 — AUDIO/multimodal transcription. Bytes-in/text-out is a genuinely
// different shape from the text-only client above, so it gets its own
// interface; a provider implements both LLMClient and TranscriptionClient if it
// can transcribe (only Gemini today).
//
// Decided approach (see CEO/stt-approach-2026.html): send audio inline to
// Gemini, transcribe, discard the audio, keep only the transcript. English-
// first, but `languageHint` is wired now so multilingual is cheap later.
// Fallback if Gemini can't clear a garbling issue: swap a dedicated Cloud STT
// API (Deepgram Nova-3 / gpt-4o-transcribe) behind the same route.

export type TranscriptionOptions = {
  /** Raw recorded audio bytes (e.g. from a browser MediaRecorder Blob). */
  audio: Uint8Array;
  /**
   * IANA MIME type of the audio (e.g. "audio/webm", "audio/ogg", "audio/mp4").
   * Gemini uses this to decode the inline audio part.
   */
  mimeType: string;
  /** Optional override model id. */
  model?: string;
  /**
   * BCP-47-ish language hint (e.g. "en", "en-US"). English-first: defaults to
   * English when omitted. Forwarded to the prompt so the same code path handles
   * other languages later by passing a different hint — no new integration.
   */
  languageHint?: string;
  /** Same best-effort usage callback shape as text completions (telemetry). */
  onUsage?: UsageCallback;
};

export type TranscriptionResult = {
  /** The clean transcript of the spoken audio. */
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};

/**
 * A provider that can turn recorded audio into a clean transcript. Separate from
 * LLMClient on purpose (audio is not a text Message). Optional + additive: only
 * the Gemini client implements it today.
 */
export interface TranscriptionClient {
  transcribe(opts: TranscriptionOptions): Promise<TranscriptionResult>;
}
