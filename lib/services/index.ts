import type { Services } from "@/lib/services/types";
import type { LLMClient } from "@/lib/llm";
import { getDefaultClient } from "@/lib/llm";
import { GeminiIntentParser } from "@/lib/services/providers/intentParser.service";
import { GeminiGoalInterviewer } from "@/lib/services/providers/goalInterviewer.service";
import { GeminiKnowledgeProbe } from "@/lib/services/providers/knowledgeProbe.service";
import { GeminiPathOutliner } from "@/lib/services/providers/pathOutliner.service";
import { GeminiCheckpointEvaluator } from "@/lib/services/providers/checkpointEvaluator.service";
import { GeminiPathAdjuster } from "@/lib/services/providers/pathAdjuster.service";
import type {
  Author,
  OrchestratorPorts,
  VisualWorkers,
} from "@/lib/services/interfaces/lessonOrchestrator.interface";
import { LessonAuthor } from "@/lib/services/providers/lessonAuthor.service";
import { buildVisualWorkers } from "@/lib/services/providers/visualWorkers.service";
import type { PathConfirmationInterviewer } from "@/lib/services/interfaces/pathConfirmationInterviewer.interface";
import { GeminiPathConfirmationInterviewer } from "@/lib/services/providers/pathConfirmationInterviewer.service";
import type { OutcomeReviser } from "@/lib/services/interfaces/outcomeReviser.interface";
import { GeminiOutcomeReviser } from "@/lib/services/providers/outcomeReviser.service";
import type { Transcriber } from "@/lib/services/interfaces/transcriber.interface";
import { GeminiTranscriber } from "@/lib/services/providers/transcriber.service";
import { getDefaultTranscriptionClient } from "@/lib/llm";
import type { ImageSource } from "@/lib/services/interfaces/imageSource.interface";
import type { VideoSource } from "@/lib/services/interfaces/videoSource.interface";
import { OpenverseImageSource } from "@/lib/services/providers/openverseImageSource.service";
import { YouTubeVideoSource } from "@/lib/services/providers/youTubeVideoSource.service";
import type { ResearchAgent } from "@/lib/services/interfaces/researchAgent.interface";
import { MultiSourceResearchAgent } from "@/lib/services/providers/researchAgent.service";

/**
 * Service registry: builds each service contract's Gemini-backed
 * implementation. Every LLM-backed service requires `GOOGLE_GENAI_API_KEY`
 * and the selectors fail fast (throw) when it is missing. The image/video
 * SOURCES are keyless (Openverse anonymous search, YouTube oEmbed) so they
 * are not gated. This module is the registry's wiring only — the data types,
 * schemas, and service interfaces each live in their own module
 * (lib/services/types.ts, lib/services/interfaces/, lib/services/<domain>.ts);
 * import them directly from there rather than through this file.
 */

/** The LLM-backed selectors cannot run without the Gemini key. */
function requireApiKey(): void {
  if (!process.env.GOOGLE_GENAI_API_KEY)
    throw new Error(
      "GOOGLE_GENAI_API_KEY is required: KnowledgeCore cannot start without it. Set it in .env locally and in the Vercel project env for preview/production.",
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
    intentParser: new GeminiIntentParser(client),
    goalInterviewer: new GeminiGoalInterviewer(client),
    knowledgeProbe: new GeminiKnowledgeProbe(client),
    pathOutliner: new GeminiPathOutliner(client),
    checkpointEvaluator: new GeminiCheckpointEvaluator(client),
    pathAdjuster: new GeminiPathAdjuster(client),
  };
}

// L1 — Two-Phase Visual Lesson Pipeline: an Author (Phase 1) and per-medium
// VisualWorkers (Phase 2). This is the single swap point; the orchestrator and
// ensureLessonContent seam stay untouched.

function buildLessonAuthor(): Author {
  return new LessonAuthor(getSharedClient());
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

// L1 Slice 2 — Path Confirmation clarifying dialogue: same shared dialogue
// engine as the Goal Interview, kept as a separate selector since the locked
// `Services` type must not change.

export function getPathConfirmationInterviewer(): PathConfirmationInterviewer {
  requireApiKey();
  return new GeminiPathConfirmationInterviewer(getSharedClient());
}

// Outcome revision (founder ruling 2026-07-16): a single-shot revise call, not
// the shared dialogue engine — see outcomeRevision.ts for why. Separate
// selector since the locked `Services` type must not change.

export function getOutcomeReviser(): OutcomeReviser {
  requireApiKey();
  return new GeminiOutcomeReviser(getSharedClient());
}

// L1 Slice 3 — speech-to-text Transcriber (Gemini audio). Uses the Gemini
// audio client, not the shared text client, but the same provider + key.

export function getTranscriber(): Transcriber {
  requireApiKey();
  return new GeminiTranscriber(getDefaultTranscriptionClient());
}

// L1 Slice 4 — visual-media sources (image + video halves of the gate).
// Keyless (Openverse, YouTube oEmbed), so not guarded. SVG is authored by the
// model and sanitized locally; it has no source selector.

export function getImageSource(): ImageSource {
  return new OpenverseImageSource();
}

export function getVideoSource(): VideoSource {
  return new YouTubeVideoSource();
}

/** Convenience: the resolver pair the gate (routeVisual) consumes. */
export function getVisualResolvers(): {
  imageSource: ImageSource;
  videoSource: VideoSource;
} {
  return { imageSource: getImageSource(), videoSource: getVideoSource() };
}

// L2 — the Research Agent (ADR 9). TAVILY_API_KEY is required; the selector
// fails fast if absent. Empty-retrieval (zero sources with a valid key) is
// handled gracefully inside MultiSourceResearchAgent (T04): it returns an
// empty Bundle and the journey stays ungrounded rather than failing hard.

export function getResearchAgent(): ResearchAgent {
  if (!process.env.TAVILY_API_KEY) {
    throw new Error(
      "TAVILY_API_KEY is required: KnowledgeCore's Research Agent needs it to run. " +
        "Set TAVILY_API_KEY in .env locally and in the Vercel project env for preview/production.",
    );
  }
  return new MultiSourceResearchAgent();
}
