import type { Services } from "@/lib/services/types";
import type { LLMClient } from "@/lib/llm";
import { getDefaultClient } from "@/lib/llm";
import { MockIntentParser } from "@/lib/services/mock/mockIntentParser";
import { MockGoalInterviewer } from "@/lib/services/mock/mockGoalInterviewer";
import { MockKnowledgeProbe } from "@/lib/services/mock/mockKnowledgeProbe";
import { MockPathOutliner } from "@/lib/services/mock/mockPathOutliner";
import { MockCheckpointEvaluator } from "@/lib/services/mock/mockCheckpointEvaluator";
import { MockPathAdjuster } from "@/lib/services/mock/mockPathAdjuster";
import { LiveIntentParser } from "@/lib/services/live/liveIntentParser";
import { LiveGoalInterviewer } from "@/lib/services/live/liveGoalInterviewer";
import { LiveKnowledgeProbe } from "@/lib/services/live/liveKnowledgeProbe";
import { LivePathOutliner } from "@/lib/services/live/livePathOutliner";
import { LiveCheckpointEvaluator } from "@/lib/services/live/liveCheckpointEvaluator";
import { LivePathAdjuster } from "@/lib/services/live/livePathAdjuster";
import type { Author, OrchestratorPorts } from "@/lib/journey/lessonOrchestration";
import { LiveLessonAuthor } from "@/lib/services/live/liveLessonAuthor";
import { MockLessonAuthor } from "@/lib/services/mock/mockLessonAuthor";
import { buildVisualWorkerStubs } from "@/lib/services/live/visualWorkerStubs";
import { buildVisualWorkers } from "@/lib/services/live/liveVisualWorkers";
import type { VisualWorkers } from "@/lib/journey/lessonOrchestration";
import type { PathConfirmationInterviewer } from "@/lib/services/pathConfirmation";
import { LivePathConfirmationInterviewer } from "@/lib/services/live/livePathConfirmationInterviewer";
import { MockPathConfirmationInterviewer } from "@/lib/services/mock/mockPathConfirmationInterviewer";
import type { Transcriber } from "@/lib/services/transcription";
import { LiveTranscriber } from "@/lib/services/live/liveTranscriber";
import { MockTranscriber } from "@/lib/services/mock/mockTranscriber";
import { getDefaultTranscriptionClient } from "@/lib/llm";
import type { ImageSource, VideoSource } from "@/lib/services/visualMedia";
import { LiveOpenverseImageSource } from "@/lib/services/live/liveOpenverseImageSource";
import { MockImageSource } from "@/lib/services/mock/mockImageSource";
import { LiveYouTubeVideoSource } from "@/lib/services/live/liveYouTubeVideoSource";
import { MockVideoSource } from "@/lib/services/mock/mockVideoSource";
import type { ResearchAgent } from "@/lib/services/research";
import { MockResearchAgent } from "@/lib/services/mock/mockResearchAgent";

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
 * Service registry. DEFAULT-TO-LIVE on Gemini: with `GOOGLE_GENAI_API_KEY`
 * present every service is live, and each per-service `LIVE_*` flag is an opt-out
 * (mock only if set to the string "false"). Construction failures degrade to a
 * warn + mock fallback. The aggregate mode reports "live" only when ALL services
 * are live, so the UI never claims a guarantee a mocked dependency can't keep.
 */

type ServiceName =
  | "intentParser"
  | "goalInterviewer"
  | "knowledgeProbe"
  | "pathOutliner"
  | "checkpointEvaluator"
  | "pathAdjuster";

type ServiceMode = "mock" | "live";

const LIVE_ENV_FLAG: Record<ServiceName, string> = {
  intentParser: "LIVE_INTENT_PARSER",
  goalInterviewer: "LIVE_GOAL_INTERVIEWER",
  knowledgeProbe: "LIVE_KNOWLEDGE_PROBE",
  pathOutliner: "LIVE_PATH_OUTLINER",
  checkpointEvaluator: "LIVE_CHECKPOINT_EVALUATOR",
  pathAdjuster: "LIVE_PATH_ADJUSTER",
};

const fallbackOnce = new Set<string>();

/** Warn once per (service, reason) per process; stable shape for log aggregation. */
function warnFallback(service: ServiceName, reason: "no_api_key" | "build_failed"): void {
  const key = `${service}:${reason}`;
  if (fallbackOnce.has(key)) return;
  fallbackOnce.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    JSON.stringify({
      event: "service_registry.fallback_to_mock",
      service,
      reason,
      envFlag: LIVE_ENV_FLAG[service],
      hint:
        reason === "no_api_key"
          ? "Set GOOGLE_GENAI_API_KEY to enable live mode (live is the default once the key is present)."
          : "Live implementation failed to construct; this service fell back to mock.",
    }),
  );
}

function wantsLive(service: ServiceName): boolean {
  if (!process.env.GOOGLE_GENAI_API_KEY) return false;
  return process.env[LIVE_ENV_FLAG[service]] !== "false";
}

// Shared, lazily-built Gemini client: deferring construction means pure-mock runs
// (no key) never touch the client, which would throw.
let sharedClient: LLMClient | null = null;
function getSharedClient(): LLMClient {
  if (!sharedClient) {
    sharedClient = getDefaultClient();
  }
  return sharedClient;
}

function buildLiveIntentParser(): Services["intentParser"] {
  return new LiveIntentParser(getSharedClient());
}
function buildLiveGoalInterviewer(): Services["goalInterviewer"] {
  return new LiveGoalInterviewer(getSharedClient());
}
function buildLiveKnowledgeProbe(): Services["knowledgeProbe"] {
  return new LiveKnowledgeProbe(getSharedClient());
}
function buildLivePathOutliner(): Services["pathOutliner"] {
  return new LivePathOutliner(getSharedClient());
}
function buildLiveCheckpointEvaluator(): Services["checkpointEvaluator"] {
  return new LiveCheckpointEvaluator(getSharedClient());
}
function buildLivePathAdjuster(): Services["pathAdjuster"] {
  return new LivePathAdjuster(getSharedClient());
}

function buildIntentParser(): { impl: Services["intentParser"]; mode: ServiceMode } {
  if (wantsLive("intentParser")) {
    try {
      return { impl: buildLiveIntentParser(), mode: "live" };
    } catch {
      warnFallback("intentParser", "build_failed");
    }
  } else if (!process.env.GOOGLE_GENAI_API_KEY) {
    warnFallback("intentParser", "no_api_key");
  }
  return { impl: new MockIntentParser(), mode: "mock" };
}

function buildGoalInterviewer(): { impl: Services["goalInterviewer"]; mode: ServiceMode } {
  if (wantsLive("goalInterviewer")) {
    try {
      return { impl: buildLiveGoalInterviewer(), mode: "live" };
    } catch {
      warnFallback("goalInterviewer", "build_failed");
    }
  } else if (!process.env.GOOGLE_GENAI_API_KEY) {
    warnFallback("goalInterviewer", "no_api_key");
  }
  return { impl: new MockGoalInterviewer(), mode: "mock" };
}

function buildKnowledgeProbe(): { impl: Services["knowledgeProbe"]; mode: ServiceMode } {
  if (wantsLive("knowledgeProbe")) {
    try {
      return { impl: buildLiveKnowledgeProbe(), mode: "live" };
    } catch {
      warnFallback("knowledgeProbe", "build_failed");
    }
  } else if (!process.env.GOOGLE_GENAI_API_KEY) {
    warnFallback("knowledgeProbe", "no_api_key");
  }
  return { impl: new MockKnowledgeProbe(), mode: "mock" };
}

function buildPathOutliner(): { impl: Services["pathOutliner"]; mode: ServiceMode } {
  if (wantsLive("pathOutliner")) {
    try {
      return { impl: buildLivePathOutliner(), mode: "live" };
    } catch {
      warnFallback("pathOutliner", "build_failed");
    }
  } else if (!process.env.GOOGLE_GENAI_API_KEY) {
    warnFallback("pathOutliner", "no_api_key");
  }
  return { impl: new MockPathOutliner(), mode: "mock" };
}

function buildCheckpointEvaluator(): { impl: Services["checkpointEvaluator"]; mode: ServiceMode } {
  if (wantsLive("checkpointEvaluator")) {
    try {
      return { impl: buildLiveCheckpointEvaluator(), mode: "live" };
    } catch {
      warnFallback("checkpointEvaluator", "build_failed");
    }
  } else if (!process.env.GOOGLE_GENAI_API_KEY) {
    warnFallback("checkpointEvaluator", "no_api_key");
  }
  return { impl: new MockCheckpointEvaluator(), mode: "mock" };
}

function buildPathAdjuster(): { impl: Services["pathAdjuster"]; mode: ServiceMode } {
  if (wantsLive("pathAdjuster")) {
    try {
      return { impl: buildLivePathAdjuster(), mode: "live" };
    } catch {
      warnFallback("pathAdjuster", "build_failed");
    }
  } else if (!process.env.GOOGLE_GENAI_API_KEY) {
    warnFallback("pathAdjuster", "no_api_key");
  }
  return { impl: new MockPathAdjuster(), mode: "mock" };
}

export function getServices(): Services {
  const intentParser = buildIntentParser();
  const goalInterviewer = buildGoalInterviewer();
  const knowledgeProbe = buildKnowledgeProbe();
  const pathOutliner = buildPathOutliner();
  const checkpointEvaluator = buildCheckpointEvaluator();
  const pathAdjuster = buildPathAdjuster();

  const allLive =
    intentParser.mode === "live" &&
    goalInterviewer.mode === "live" &&
    knowledgeProbe.mode === "live" &&
    pathOutliner.mode === "live" &&
    checkpointEvaluator.mode === "live" &&
    pathAdjuster.mode === "live";

  return {
    intentParser: intentParser.impl,
    goalInterviewer: goalInterviewer.impl,
    knowledgeProbe: knowledgeProbe.impl,
    pathOutliner: pathOutliner.impl,
    checkpointEvaluator: checkpointEvaluator.impl,
    pathAdjuster: pathAdjuster.impl,
    mode: allLive ? "live" : "mock",
  };
}

// Default-to-live on GOOGLE_GENAI_API_KEY with a per-service `LIVE_LESSON_CONTENT=false`
// opt-out; kept OUT of the LOCKED `Services` type (lib/services/types.ts must not change).
const LIVE_LESSON_CONTENT_FLAG = "LIVE_LESSON_CONTENT";

function wantsLiveLessonContent(): boolean {
  if (!process.env.GOOGLE_GENAI_API_KEY) return false;
  return process.env[LIVE_LESSON_CONTENT_FLAG] !== "false";
}

// ---------------------------------------------------------------------------
// L1 — Two-Phase Visual Lesson Pipeline. The orchestrator runs over two PORTS:
// an Author (Phase 1) and per-medium VisualWorkers (Phase 2). This is the SINGLE
// swap point; the orchestrator and ensureLessonContent seam stay untouched.
// ---------------------------------------------------------------------------

function buildLessonAuthor(): Author {
  if (wantsLiveLessonContent()) {
    try {
      return new LiveLessonAuthor(getSharedClient());
    } catch {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          event: "service_registry.fallback_to_mock",
          service: "lessonAuthor",
          reason: "build_failed",
          envFlag: LIVE_LESSON_CONTENT_FLAG,
          hint: "Live Phase-1 Author failed to construct; fell back to the mock author.",
        }),
      );
    }
  }
  return new MockLessonAuthor();
}

/**
 * Build the real Phase-2 visual workers, gated on the SAME default-to-live on the
 * Gemini key + `LIVE_LESSON_CONTENT=false` opt-out as the Author (the SVG worker
 * authors via the shared LLM client, so it lives or dies with the live content
 * path). When live is unavailable (no key, opted out, or construction throws) we
 * fall back to the safe-degrading stubs so offline / mock / verify runs still
 * assemble (the stubs drop every SVG slot and search the keyless image/video
 * sources). The image/video sources keep their OWN `LIVE_IMAGE_SOURCE` /
 * `LIVE_VIDEO_SOURCE` opt-outs via getVisualResolvers().
 */
function buildLessonVisualWorkers(): VisualWorkers {
  const resolvers = getVisualResolvers();
  if (wantsLiveLessonContent()) {
    try {
      return buildVisualWorkers({
        llm: getSharedClient(),
        imageSource: resolvers.imageSource,
        videoSource: resolvers.videoSource,
      });
    } catch {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          event: "service_registry.fallback_to_mock",
          service: "visualWorkers",
          reason: "build_failed",
          envFlag: LIVE_LESSON_CONTENT_FLAG,
          hint: "Live visual workers failed to construct; fell back to the safe-degrading stubs.",
        }),
      );
    }
  }
  // Offline / mock path: the SVG stub drops; image/video stubs use keyless sources.
  return buildVisualWorkerStubs(resolvers);
}

export function getLessonOrchestratorPorts(): OrchestratorPorts {
  return {
    author: buildLessonAuthor(),
    workers: buildLessonVisualWorkers(),
  };
}

// ---------------------------------------------------------------------------
// L1 Slice 2 — the Path Confirmation clarifying-dialogue interviewer.
//
// Same SHARED dialogue engine as the Goal Interview, instantiated in the new
// Path Confirmation context. Kept as a SEPARATE selector (the LOCKED `Services`
// type must not change), following the same default-to-live on
// `GOOGLE_GENAI_API_KEY` + per-service opt-out (`LIVE_PATH_CONFIRMATION=false`)
// + graceful mock fallback pattern as `getServices()`.
// ---------------------------------------------------------------------------

const LIVE_PATH_CONFIRMATION_FLAG = "LIVE_PATH_CONFIRMATION";

function wantsLivePathConfirmation(): boolean {
  if (!process.env.GOOGLE_GENAI_API_KEY) return false;
  return process.env[LIVE_PATH_CONFIRMATION_FLAG] !== "false";
}

export function getPathConfirmationInterviewer(): PathConfirmationInterviewer {
  if (wantsLivePathConfirmation()) {
    try {
      return new LivePathConfirmationInterviewer(getSharedClient());
    } catch {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          event: "service_registry.fallback_to_mock",
          service: "pathConfirmationInterviewer",
          reason: "build_failed",
          envFlag: LIVE_PATH_CONFIRMATION_FLAG,
          hint: "Live path-confirmation interviewer failed to construct; fell back to mock.",
        }),
      );
    }
  } else if (!process.env.GOOGLE_GENAI_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        event: "service_registry.fallback_to_mock",
        service: "pathConfirmationInterviewer",
        reason: "no_api_key",
        envFlag: LIVE_PATH_CONFIRMATION_FLAG,
        hint: "Set GOOGLE_GENAI_API_KEY to enable the live path-confirmation dialogue.",
      }),
    );
  }
  return new MockPathConfirmationInterviewer();
}

// ---------------------------------------------------------------------------
// L1 Slice 3 — the speech-to-text Transcriber (Gemini audio).
//
// Same SEPARATE-selector pattern as getPathConfirmationInterviewer (the LOCKED
// `Services` type must not change):
// default-to-live on `GOOGLE_GENAI_API_KEY` with a `LIVE_STT=false` opt-out and
// a graceful mock fallback. The live transcriber uses the Gemini AUDIO client
// (getDefaultTranscriptionClient), not the shared text client, but that is the
// same underlying provider + key.
// ---------------------------------------------------------------------------

const LIVE_STT_FLAG = "LIVE_STT";

function wantsLiveStt(): boolean {
  if (!process.env.GOOGLE_GENAI_API_KEY) return false;
  return process.env[LIVE_STT_FLAG] !== "false";
}

export function getTranscriber(): Transcriber {
  if (wantsLiveStt()) {
    try {
      return new LiveTranscriber(getDefaultTranscriptionClient());
    } catch {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          event: "service_registry.fallback_to_mock",
          service: "transcriber",
          reason: "build_failed",
          envFlag: LIVE_STT_FLAG,
          hint: "Live (Gemini-audio) transcriber failed to construct; fell back to mock.",
        }),
      );
    }
  } else if (!process.env.GOOGLE_GENAI_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        event: "service_registry.fallback_to_mock",
        service: "transcriber",
        reason: "no_api_key",
        envFlag: LIVE_STT_FLAG,
        hint: "Set GOOGLE_GENAI_API_KEY to enable live Gemini-audio transcription.",
      }),
    );
  }
  return new MockTranscriber();
}

// ---------------------------------------------------------------------------
// L1 Slice 4 — visual-media SOURCES (the image + video halves of the gate).
//
// Unlike the LLM-backed services, these sources do NOT need GOOGLE_GENAI_API_KEY:
// Openverse anonymous search and YouTube oEmbed are keyless. So the gating is an
// explicit OPT-OUT to mock for deterministic / offline runs: a source is LIVE by
// default and falls back to mock only when its flag is set to "false" (or
// NODE_ENV=test, so the verify script + unit tests never hit the network). The
// SVG half of the gate is pure (the model authors it; it is sanitized locally),
// so it has no source selector.
// ---------------------------------------------------------------------------

const LIVE_IMAGE_SOURCE_FLAG = "LIVE_IMAGE_SOURCE";
const LIVE_VIDEO_SOURCE_FLAG = "LIVE_VIDEO_SOURCE";

function wantsLiveSource(flag: string): boolean {
  if (process.env.NODE_ENV === "test") return false;
  return process.env[flag] !== "false";
}

export function getImageSource(): ImageSource {
  if (wantsLiveSource(LIVE_IMAGE_SOURCE_FLAG)) {
    try {
      return new LiveOpenverseImageSource();
    } catch {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          event: "service_registry.fallback_to_mock",
          service: "imageSource",
          reason: "build_failed",
          envFlag: LIVE_IMAGE_SOURCE_FLAG,
          hint: "Live Openverse image source failed to construct; fell back to mock.",
        }),
      );
    }
  }
  return new MockImageSource();
}

export function getVideoSource(): VideoSource {
  if (wantsLiveSource(LIVE_VIDEO_SOURCE_FLAG)) {
    try {
      return new LiveYouTubeVideoSource();
    } catch {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          event: "service_registry.fallback_to_mock",
          service: "videoSource",
          reason: "build_failed",
          envFlag: LIVE_VIDEO_SOURCE_FLAG,
          hint: "Live YouTube video source failed to construct; fell back to mock.",
        }),
      );
    }
  }
  return new MockVideoSource();
}

/** Convenience: the resolver pair the gate (routeVisual) consumes. */
export function getVisualResolvers(): {
  imageSource: ImageSource;
  videoSource: VideoSource;
} {
  return { imageSource: getImageSource(), videoSource: getVideoSource() };
}

// ---------------------------------------------------------------------------
// L2 Phase 0 — the Research Agent (the source layer behind the Library).
//
// Same SEPARATE-selector pattern as the L1 services (the LOCKED `Services` type
// must not change). Phase 0 ships the MOCK ONLY (deterministic canned bundle,
// zero network / keys / embeddings), so this DEFAULTS TO MOCK regardless of env.
// `LIVE_RESEARCH=true` is the forward-compat OPT-IN switch for the live agent
// that lands in a later phase; until that agent exists the selector logs the
// opt-in and still returns the mock, so Phase 0 can never accidentally hit the
// network or require a key.
// ---------------------------------------------------------------------------

const LIVE_RESEARCH_FLAG = "LIVE_RESEARCH";

function wantsLiveResearch(): boolean {
  return process.env[LIVE_RESEARCH_FLAG] === "true";
}

export function getResearchAgent(): ResearchAgent {
  if (wantsLiveResearch()) {
    // No live agent exists in Phase 0; the source layer + retrieval land later.
    // Default to mock so the spine stays offline / key-free and never breaks.
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        event: "service_registry.fallback_to_mock",
        service: "researchAgent",
        reason: "build_failed",
        envFlag: LIVE_RESEARCH_FLAG,
        hint: "LIVE_RESEARCH=true but no live Research Agent exists in Phase 0; using the mock.",
      }),
    );
  }
  return new MockResearchAgent();
}
