import type {
  Transcriber,
  TranscribeInput,
  TranscribeResult,
} from "@/lib/services/transcription";

/**
 * L1 Slice 3 — deterministic mock transcriber.
 *
 * No audio decoding, no network, no DB. It proves the CONTRACT — audio bytes in,
 * a transcript string out — without depending on a live Gemini call or real
 * recorded audio, so the verify-stt script (and any test harness) is fully
 * deterministic.
 *
 * Behaviour:
 *  - An EMPTY recording (0 bytes) -> empty transcript (the silent-audio contract).
 *  - Otherwise -> a stable canned transcript whose length scales loosely with the
 *    audio size, so a test can assert that bytes flowed through to a non-empty
 *    transcript. It NEVER retains the audio (nothing is stored).
 */
export class MockTranscriber implements Transcriber {
  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    if (input.audio.byteLength === 0) {
      return { transcript: "" };
    }
    // Deterministic, recognisable transcript. The kHz-ish number is derived from
    // the byte length so different recordings yield observably different text,
    // proving the audio was actually consumed (not ignored).
    const sizeTag = input.audio.byteLength;
    return {
      transcript: `This is a mock transcript of ${sizeTag} bytes of spoken audio.`,
    };
  }
}
