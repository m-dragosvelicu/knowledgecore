/**
 * The Transcriber data types (speech-to-text): recorded audio in, clean
 * transcript out. Additive — lives alongside the locked `lib/services/types.ts`
 * boundary, wired through the registry like the other L1 services. Audio is
 * NOT persisted anywhere; only the transcript and a telemetry row survive.
 * English-first; `languageHint` is wired so multilingual is a parameter change
 * later, not a new integration. The `Transcriber` interface itself lives in
 * `lib/services/interfaces/transcriber.interface.ts`.
 */

export type TranscribeInput = {
  /** Raw recorded audio bytes (browser MediaRecorder Blob -> ArrayBuffer). */
  audio: Uint8Array;
  /** IANA MIME type of the recording (e.g. "audio/webm"). */
  mimeType: string;
  /**
   * Optional language hint (BCP-47-ish, e.g. "en"). Defaults to English. Present
   * so a future multilingual story is a parameter pass, not a new integration.
   */
  languageHint?: string;
};

export type TranscribeResult = {
  /** The clean transcript. May be empty for a silent/unintelligible recording. */
  transcript: string;
};
