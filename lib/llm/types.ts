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

// =====================================================================
// L1 Slice 3 — AUDIO / multimodal transcription (speech-to-text).
//
// The client above is TEXT-ONLY (Message.content is a string). Transcription is
// a genuinely different shape — bytes in, text out — so it lives in its OWN
// interface rather than overloading Message. A provider that can transcribe
// (the Gemini client) implements BOTH LLMClient and TranscriptionClient; a
// text-only provider implements only LLMClient. This keeps the text contract
// clean while making the audio capability explicitly discoverable + testable.
//
// DECIDED APPROACH: Gemini audio input (see CEO/stt-approach-2026.html). The
// audio is sent inline to Gemini, transcribed, and DISCARDED — only the returned
// transcript is kept. English-first; `languageHint` is wired now (a parameter,
// not an architecture change) so multilingual is roughly free later.
//
// FALLBACK (documented, NOT built now): if real production audio shows a garbling
// problem Gemini can't clear, a dedicated Cloud STT API — Deepgram Nova-3 or
// OpenAI gpt-4o-transcribe — is a localized swap behind the same server route
// with no learner-facing change. Multilingual would also route through the same
// seam. See the reading-room note for the comparison.
// =====================================================================

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
