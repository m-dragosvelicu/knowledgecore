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
import type { LessonContentGenerator } from "@/lib/services/lessonContent";
import { LiveLessonContentGenerator } from "@/lib/services/live/liveLessonContentGenerator";
import { MockLessonContentGenerator } from "@/lib/services/mock/mockLessonContentGenerator";
import type { PathConfirmationInterviewer } from "@/lib/services/pathConfirmation";
import { LivePathConfirmationInterviewer } from "@/lib/services/live/livePathConfirmationInterviewer";
import { MockPathConfirmationInterviewer } from "@/lib/services/mock/mockPathConfirmationInterviewer";
import type { Transcriber } from "@/lib/services/transcription";
import { LiveTranscriber } from "@/lib/services/live/liveTranscriber";
import { MockTranscriber } from "@/lib/services/mock/mockTranscriber";
import { getDefaultTranscriptionClient } from "@/lib/llm";

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

/**
 * Service registry.
 *
 * Strategy: DEFAULT-TO-LIVE on Google Gemini. The global precondition for any live service
 * is `GOOGLE_GENAI_API_KEY`. When that key is present, every service is LIVE by default and
 * the per-service `LIVE_*` flag becomes an OPT-OUT switch: a service falls back to mock only
 * if its flag is explicitly set to the string `"false"`. This lets an operator disable a
 * single live service (e.g. `LIVE_INTENT_PARSER=false`) without touching the other four.
 *
 * The live builders construct the real Gemini-backed implementations from `lib/services/live`.
 * If construction throws (e.g. transient client init failure), the try/catch below converts
 * it into a structured warn + mock fallback so the app degrades gracefully rather than crashing.
 *
 * Boundary notes:
 * - Do NOT change `lib/services/types.ts`; it is the LOCKED interface boundary.
 * - The binary mock/live mode flag on the returned `Services` object flips to "live" only when
 *   ALL five services are live. Mixed-mode is reported as "mock" so the UI doesn't claim
 *   guarantees a mocked dependency can't keep.
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

/**
 * Emit a structured warning exactly once per (service, reason) tuple per process. Shape is
 * stable so the line can be grepped/aggregated by log tooling later. Console.warn so it
 * shows up in Vercel runtime logs without bringing in a logger dependency.
 */
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

/**
 * Returns true iff the global precondition (Gemini key) is satisfied AND this service has not
 * been explicitly opted OUT. Default-to-live: with the key present, a service is live unless
 * its per-service flag is set to the string "false".
 */
function wantsLive(service: ServiceName): boolean {
  if (!process.env.GOOGLE_GENAI_API_KEY) return false;
  return process.env[LIVE_ENV_FLAG[service]] !== "false";
}

// ---------------------------------------------------------------------------
// Shared Gemini client. Built lazily once per process and reused across every
// live service so we don't spin up a separate GoogleGenAI instance per service.
// Construction is deferred until a live service is actually requested so that
// pure-mock runs (no key) never touch the client (which would throw).
// ---------------------------------------------------------------------------

let sharedClient: LLMClient | null = null;
function getSharedClient(): LLMClient {
  if (!sharedClient) {
    sharedClient = getDefaultClient();
  }
  return sharedClient;
}

// ---------------------------------------------------------------------------
// Live builders — construct the real Gemini-backed implementations. Each takes
// the shared LLM client. A throw here is caught by the per-service builder
// below and converted into a warn + mock fallback.
// ---------------------------------------------------------------------------

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

  // The aggregate mode reports "live" only when every service is live. Mixed-mode (some
  // live, some mock) reports "mock" so the UI cannot accidentally claim guarantees a
  // mocked dependency can't honour. Per-service modes are an internal detail.
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

// ---------------------------------------------------------------------------
// L1 Slice 1 — Call B (lesson-content) generator.
//
// Kept as a SEPARATE selector rather than added to the LOCKED `Services` type
// (lib/services/types.ts must not change). It follows the same default-to-live
// on `GOOGLE_GENAI_API_KEY` + per-service opt-out (`LIVE_LESSON_CONTENT=false`)
// + graceful mock fallback pattern as `getServices()`.
// ---------------------------------------------------------------------------

const LIVE_LESSON_CONTENT_FLAG = "LIVE_LESSON_CONTENT";

function wantsLiveLessonContent(): boolean {
  if (!process.env.GOOGLE_GENAI_API_KEY) return false;
  return process.env[LIVE_LESSON_CONTENT_FLAG] !== "false";
}

export function getLessonContentGenerator(): LessonContentGenerator {
  if (wantsLiveLessonContent()) {
    try {
      return new LiveLessonContentGenerator(getSharedClient());
    } catch {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          event: "service_registry.fallback_to_mock",
          service: "lessonContentGenerator",
          reason: "build_failed",
          envFlag: LIVE_LESSON_CONTENT_FLAG,
          hint: "Live lesson-content generator failed to construct; fell back to mock.",
        }),
      );
    }
  } else if (!process.env.GOOGLE_GENAI_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        event: "service_registry.fallback_to_mock",
        service: "lessonContentGenerator",
        reason: "no_api_key",
        envFlag: LIVE_LESSON_CONTENT_FLAG,
        hint: "Set GOOGLE_GENAI_API_KEY to enable live lesson-content generation.",
      }),
    );
  }
  return new MockLessonContentGenerator();
}

// ---------------------------------------------------------------------------
// L1 Slice 2 — the Path Confirmation clarifying-dialogue interviewer.
//
// Same SHARED dialogue engine as the Goal Interview, instantiated in the new
// Path Confirmation context. Kept as a SEPARATE selector (the LOCKED `Services`
// type must not change), following the same default-to-live on
// `GOOGLE_GENAI_API_KEY` + per-service opt-out (`LIVE_PATH_CONFIRMATION=false`)
// + graceful mock fallback pattern as `getLessonContentGenerator()`.
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
// Same SEPARATE-selector pattern as getLessonContentGenerator /
// getPathConfirmationInterviewer (the LOCKED `Services` type must not change):
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
