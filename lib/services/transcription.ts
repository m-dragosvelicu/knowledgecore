/**
 * L1 Slice 3 — the Transcriber contract (speech-to-text).
 *
 * Mirrors the other L1 additive services (lessonContent.ts, pathConfirmation.ts):
 * it lives ALONGSIDE the LOCKED `lib/services/types.ts` boundary, never inside it,
 * and is wired through the registry with a default-to-live + `LIVE_STT=false`
 * opt-out, exactly like getLessonContentGenerator / getPathConfirmationInterviewer.
 *
 * Contract: recorded audio in -> clean transcript out. The audio is NOT persisted
 * anywhere; the live implementation transcribes and discards it (only the
 * transcript + a telemetry row survive). English-first; `languageHint` is wired so
 * multilingual is roughly free later (a parameter, not an architecture change).
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

export interface Transcriber {
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}
