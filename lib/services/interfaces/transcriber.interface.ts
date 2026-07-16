import type {
  TranscribeInput,
  TranscribeResult,
} from "@/lib/services/transcription";

export interface Transcriber {
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}
