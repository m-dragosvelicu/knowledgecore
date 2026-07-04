import type { Services } from "@/lib/services/types";
import type { LLMClient } from "@/lib/llm";
import { getDefaultClient } from "@/lib/llm";
import { LiveIntentParser } from "@/lib/services/live/liveIntentParser";
import { LiveGoalInterviewer } from "@/lib/services/live/liveGoalInterviewer";
import { LiveKnowledgeProbe } from "@/lib/services/live/liveKnowledgeProbe";
import { LivePathOutliner } from "@/lib/services/live/livePathOutliner";
import { LiveCheckpointEvaluator } from "@/lib/services/live/liveCheckpointEvaluator";
import { LivePathAdjuster } from "@/lib/services/live/livePathAdjuster";
import type { Author, OrchestratorPorts } from "@/lib/journey/lessonOrchestration";
import { LiveLessonAuthor } from "@/lib/services/live/liveLessonAuthor";
import { buildVisualWorkers } from "@/lib/services/live/liveVisualWorkers";
import type { VisualWorkers } from "@/lib/journey/lessonOrchestration";
import type { PathConfirmationInterviewer } from "@/lib/services/pathConfirmation";
import { LivePathConfirmationInterviewer } from "@/lib/services/live/livePathConfirmationInterviewer";
import type { Transcriber } from "@/lib/services/transcription";
import { LiveTranscriber } from "@/lib/services/live/liveTranscriber";
import { getDefaultTranscriptionClient } from "@/lib/llm";
import type { ImageSource, VideoSource } from "@/lib/services/visualMedia";
import { LiveOpenverseImageSource } from "@/lib/services/live/liveOpenverseImageSource";
import { LiveYouTubeVideoSource } from "@/lib/services/live/liveYouTubeVideoSource";
import type { ResearchAgent } from "@/lib/services/research";
import { LiveResearchAgent } from "@/lib/services/live/liveResearchAgent";

export * from "@/lib/services/types";
export type { LessonContentGenerator } from "@/lib/services/lessonContent";
export type {
  PathConfirmationInterviewer,
  PathConfirmationInput,
  PathConfirmationStep,
  OverviewGoalpost,
} from "@/lib/services/pathConfirmation";
export type {
  Transcriber,
  TranscribeInput,
  TranscribeResult,
} from "@/lib/services/transcription";
export type {
  ImageSource,
  VideoSource,
  VisualKind,
  VisualMedium,
  VisualNeed,
  ResolvedVisual,
  ImageAttribution,
} from "@/lib/services/visualMedia";
export type {
  ResearchAgent,
  Bundle,
  Source,
  Chunk,
  GapQueries,
} from "@/lib/services/research";

/**
 * Service registry. LIVE-ONLY: every LLM-backed service requires
 * `GOOGLE_GENAI_API_KEY` and the selectors fail fast (throw) when it is missing.
 * There is no mock fallback and no per-service opt-out. The image/video SOURCES
 * are keyless (Openverse anonymous search, YouTube oEmbed) so they are not gated.
 */

/** Live-only guard: the LLM-backed selectors cannot run without the Gemini key. */
function requireApiKey(): void {
  if (!process.env.GOOGLE_GENAI_API_KEY)
    throw new Error(
      "GOOGLE_GENAI_API_KEY is required: KnowledgeCore runs live-only and cannot start without it. Set it in .env locally and in the Vercel project env for preview/production.",
    );
}

// Shared, lazily-built Gemini client so a process that never calls a selector
// (e.g. importing only types) never constructs it.
let sharedClient: LLMClient | null = null;
function getSharedClient(): LLMClient {
  if (!sharedClient) {
    sharedClient = getDefaultClient();
  }
  return sharedClient;
}

export function getServices(): Services {
  requireApiKey();
  const client = getSharedClient();
  return {
    intentParser: new LiveIntentParser(client),
    goalInterviewer: new LiveGoalInterviewer(client),
    knowledgeProbe: new LiveKnowledgeProbe(client),
    pathOutliner: new LivePathOutliner(client),
    checkpointEvaluator: new LiveCheckpointEvaluator(client),
    pathAdjuster: new LivePathAdjuster(client),
    mode: "live",
  };
}

// ---------------------------------------------------------------------------
// L1 — Two-Phase Visual Lesson Pipeline. The orchestrator runs over two PORTS:
// an Author (Phase 1) and per-medium VisualWorkers (Phase 2). This is the SINGLE
// swap point; the orchestrator and ensureLessonContent seam stay untouched.
// ---------------------------------------------------------------------------

function buildLessonAuthor(): Author {
  return new LiveLessonAuthor(getSharedClient());
}

function buildLessonVisualWorkers(): VisualWorkers {
  return buildVisualWorkers({
    llm: getSharedClient(),
    imageSource: getImageSource(),
    videoSource: getVideoSource(),
  });
}

export function getLessonOrchestratorPorts(): OrchestratorPorts {
  requireApiKey();
  return {
    author: buildLessonAuthor(),
    workers: buildLessonVisualWorkers(),
  };
}

// ---------------------------------------------------------------------------
// L1 Slice 2 — the Path Confirmation clarifying-dialogue interviewer. Same
// SHARED dialogue engine as the Goal Interview, in the Path Confirmation context.
// Kept as a SEPARATE selector (the LOCKED `Services` type must not change).
// ---------------------------------------------------------------------------

export function getPathConfirmationInterviewer(): PathConfirmationInterviewer {
  requireApiKey();
  return new LivePathConfirmationInterviewer(getSharedClient());
}

// ---------------------------------------------------------------------------
// L1 Slice 3 — the speech-to-text Transcriber (Gemini audio). Uses the Gemini
// AUDIO client, not the shared text client, but the same provider + key.
// ---------------------------------------------------------------------------

export function getTranscriber(): Transcriber {
  requireApiKey();
  return new LiveTranscriber(getDefaultTranscriptionClient());
}

// ---------------------------------------------------------------------------
// L1 Slice 4 — visual-media SOURCES (the image + video halves of the gate).
// Keyless: Openverse anonymous search and YouTube oEmbed need no API key, so
// these are NOT guarded. The SVG half is pure (the model authors it; it is
// sanitized locally), so it has no source selector.
// ---------------------------------------------------------------------------

export function getImageSource(): ImageSource {
  return new LiveOpenverseImageSource();
}

export function getVideoSource(): VideoSource {
  return new LiveYouTubeVideoSource();
}

/** Convenience: the resolver pair the gate (routeVisual) consumes. */
export function getVisualResolvers(): {
  imageSource: ImageSource;
  videoSource: VideoSource;
} {
  return { imageSource: getImageSource(), videoSource: getVideoSource() };
}

// ---------------------------------------------------------------------------
// L2 — the Research Agent (live, ADR 9 ratified).
//
// The live agent is the ONLY path. TAVILY_API_KEY is required and the selector
// throws immediately if it is absent (fail-fast, consistent with live-only
// philosophy). Empty-retrieval (zero usable sources WITH a valid key) is handled
// gracefully inside LiveResearchAgent itself (T04): it returns an empty Bundle
// and the journey stays ungrounded rather than failing hard.
// ---------------------------------------------------------------------------

export function getResearchAgent(): ResearchAgent {
  if (!process.env.TAVILY_API_KEY) {
    throw new Error(
      "TAVILY_API_KEY is required: KnowledgeCore's Research Agent runs live-only. " +
        "Set TAVILY_API_KEY in .env locally and in the Vercel project env for preview/production.",
    );
  }
  return new LiveResearchAgent();
}
