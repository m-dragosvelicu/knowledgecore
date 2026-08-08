import type { TranscriptionClient, TranscriptionResult } from "@/lib/llm";
import { computeCostMicroUsd, getLlmTelemetryContext } from "@/lib/llm";
import { prisma } from "@/lib/db";
import type {
  TranscribeInput,
  TranscribeResult,
} from "@/lib/services/transcription";
import type { Transcriber } from "@/lib/services/interfaces/transcriber.interface";

// Fallback model id for the telemetry row when a failure short-circuits the call
// before usage is reported. Mirrors the other providers' TELEMETRY_MODEL.
const TELEMETRY_MODEL =
  process.env.GEMINI_STT_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

type TelemetrySnapshot = {
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  usage?: TranscriptionResult["usage"];
  model?: string;
};

/**
 * Gemini-audio speech-to-text transcriber. Sends audio to Gemini via
 * TranscriptionClient.transcribe; audio bytes are held only for the call —
 * nothing about the audio is persisted, only the LlmCall telemetry row
 * (purpose=stt_transcribe) and the returned transcript. Telemetry is
 * best-effort and never breaks transcription.
 */
export class GeminiTranscriber implements Transcriber {
  constructor(private readonly client: TranscriptionClient) {}

  private async recordLlmCall(snapshot: TelemetrySnapshot): Promise<void> {
    try {
      const model = snapshot.model ?? TELEMETRY_MODEL;
      const inputTokens = snapshot.usage?.inputTokens ?? 0;
      const outputTokens = snapshot.usage?.outputTokens ?? 0;
      // Attribution: userId is available (the route requires a session before
      // calling transcribe); intentId is genuinely unavailable — the mic input
      // is reachable on pre-journey outcome/probe steps and the route takes no
      // journey id, so it is left null rather than invented.
      const ctx = getLlmTelemetryContext();
      await prisma.llmCall.create({
        data: {
          purpose: "stt_transcribe",
          model,
          inputTokens,
          outputTokens,
          costMicroUsd: computeCostMicroUsd(model, inputTokens, outputTokens),
          latencyMs: snapshot.latencyMs,
          success: snapshot.success,
          errorMessage: snapshot.errorMessage,
          evaluationId: null,
          userId: ctx?.userId ?? null,
          intentId: ctx?.intentId ?? null,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[llm-telemetry] failed to persist stt_transcribe row: ${
          (err as Error).message
        }`,
      );
    }
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    const startedAt = Date.now();
    let usage: TranscriptionResult["usage"] | undefined;
    let usageModel: string | undefined;

    try {
      const result = await this.client.transcribe({
        audio: input.audio,
        mimeType: input.mimeType,
        languageHint: input.languageHint,
        onUsage: (u, m) => {
          usage = u;
          usageModel = m;
        },
      });

      await this.recordLlmCall({
        latencyMs: Date.now() - startedAt,
        success: true,
        errorMessage: null,
        usage,
        model: usageModel,
      });

      // Audio is intentionally NOT persisted: it goes out of scope here and is
      // garbage-collected. Only the transcript is returned.
      return { transcript: result.text };
    } catch (err) {
      await this.recordLlmCall({
        latencyMs: Date.now() - startedAt,
        success: false,
        errorMessage: (err as Error).message,
        usage,
        model: usageModel,
      });
      throw err;
    }
  }
}
