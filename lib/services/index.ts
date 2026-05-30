import type { Services } from "@/lib/services/types";
import { MockIntentParser } from "@/lib/services/mock/mockIntentParser";
import { MockGoalInterviewer } from "@/lib/services/mock/mockGoalInterviewer";
import { MockKnowledgeProbe } from "@/lib/services/mock/mockKnowledgeProbe";
import { MockPathOutliner } from "@/lib/services/mock/mockPathOutliner";
import { MockCheckpointEvaluator } from "@/lib/services/mock/mockCheckpointEvaluator";

export * from "@/lib/services/types";

/**
 * Service registry.
 *
 * Strategy: per-service env flag, with `ANTHROPIC_API_KEY` as the global precondition for
 * any live service. Each `LIVE_*` flag opts a single service into the live implementation
 * once that implementation lands (see activity B.2.x). Until then, the live builders here
 * throw, so the registry falls back to mocks and surfaces a *structured* warning that
 * downstream observability can grep on.
 *
 * Design notes for the live drop (B.2.a — Live CheckpointEvaluator):
 * 1. Replace `buildLiveCheckpointEvaluator()` with a real Anthropic-backed impl.
 * 2. Implementation MUST write an `LlmCall` row (see `prisma/schema.prisma`) on every
 *    invocation — success and failure — for L0 §9.7 cost-cap accounting.
 * 3. Do NOT change `lib/services/types.ts`; it is the LOCKED boundary. If a new field is
 *    needed (e.g. budget signal), surface as an OPEN_QUESTION to PM first.
 * 4. Keep the binary mock/live mode flag on the returned `Services` object accurate: it
 *    flips to "live" only when ALL five services are live. Mixed-mode is reported as
 *    "mock" so the UI doesn't claim guarantees it can't keep.
 */

type ServiceName =
  | "intentParser"
  | "goalInterviewer"
  | "knowledgeProbe"
  | "pathOutliner"
  | "checkpointEvaluator";

type ServiceMode = "mock" | "live";

const LIVE_ENV_FLAG: Record<ServiceName, string> = {
  intentParser: "LIVE_INTENT_PARSER",
  goalInterviewer: "LIVE_GOAL_INTERVIEWER",
  knowledgeProbe: "LIVE_KNOWLEDGE_PROBE",
  pathOutliner: "LIVE_PATH_OUTLINER",
  checkpointEvaluator: "LIVE_CHECKPOINT_EVALUATOR",
};

const fallbackOnce = new Set<string>();

/**
 * Emit a structured warning exactly once per (service, reason) tuple per process. Shape is
 * stable so the line can be grepped/aggregated by log tooling later. Console.warn so it
 * shows up in Vercel runtime logs without bringing in a logger dependency.
 */
function warnFallback(service: ServiceName, reason: "no_api_key" | "not_implemented"): void {
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
          ? "Set ANTHROPIC_API_KEY (and the per-service flag) to enable live mode."
          : "Live implementation not wired yet; this service stays on mock.",
    }),
  );
}

/**
 * Returns true iff the operator opted this service into live mode AND the global
 * precondition (Anthropic key) is satisfied. Per-service opt-in keeps a partial rollout
 * possible — i.e. flip on CheckpointEvaluator alone without touching the other four.
 */
function wantsLive(service: ServiceName): boolean {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  return process.env[LIVE_ENV_FLAG[service]] === "true";
}

// ---------------------------------------------------------------------------
// Live builders — currently all unimplemented. B.2.x activities will replace
// these stubs with real provider-backed implementations. The throw is what
// triggers the fallback path; the catch below converts it into a warn + mock.
// ---------------------------------------------------------------------------

function buildLiveIntentParser(): never {
  throw new Error("not_implemented");
}
function buildLiveGoalInterviewer(): never {
  throw new Error("not_implemented");
}
function buildLiveKnowledgeProbe(): never {
  throw new Error("not_implemented");
}
function buildLivePathOutliner(): never {
  throw new Error("not_implemented");
}
function buildLiveCheckpointEvaluator(): never {
  // B.2.a will replace this stub. The replacement MUST:
  //   - construct an Anthropic client from process.env.ANTHROPIC_API_KEY
  //   - persist an LlmCall row (success or failure) before returning
  //   - return EvaluationResult matching the locked `CheckpointEvaluator` interface
  throw new Error("not_implemented");
}

function buildIntentParser(): { impl: Services["intentParser"]; mode: ServiceMode } {
  if (wantsLive("intentParser")) {
    try {
      return { impl: buildLiveIntentParser(), mode: "live" };
    } catch {
      warnFallback("intentParser", "not_implemented");
    }
  } else if (!process.env.ANTHROPIC_API_KEY) {
    warnFallback("intentParser", "no_api_key");
  }
  return { impl: new MockIntentParser(), mode: "mock" };
}

function buildGoalInterviewer(): { impl: Services["goalInterviewer"]; mode: ServiceMode } {
  if (wantsLive("goalInterviewer")) {
    try {
      return { impl: buildLiveGoalInterviewer(), mode: "live" };
    } catch {
      warnFallback("goalInterviewer", "not_implemented");
    }
  } else if (!process.env.ANTHROPIC_API_KEY) {
    warnFallback("goalInterviewer", "no_api_key");
  }
  return { impl: new MockGoalInterviewer(), mode: "mock" };
}

function buildKnowledgeProbe(): { impl: Services["knowledgeProbe"]; mode: ServiceMode } {
  if (wantsLive("knowledgeProbe")) {
    try {
      return { impl: buildLiveKnowledgeProbe(), mode: "live" };
    } catch {
      warnFallback("knowledgeProbe", "not_implemented");
    }
  } else if (!process.env.ANTHROPIC_API_KEY) {
    warnFallback("knowledgeProbe", "no_api_key");
  }
  return { impl: new MockKnowledgeProbe(), mode: "mock" };
}

function buildPathOutliner(): { impl: Services["pathOutliner"]; mode: ServiceMode } {
  if (wantsLive("pathOutliner")) {
    try {
      return { impl: buildLivePathOutliner(), mode: "live" };
    } catch {
      warnFallback("pathOutliner", "not_implemented");
    }
  } else if (!process.env.ANTHROPIC_API_KEY) {
    warnFallback("pathOutliner", "no_api_key");
  }
  return { impl: new MockPathOutliner(), mode: "mock" };
}

function buildCheckpointEvaluator(): { impl: Services["checkpointEvaluator"]; mode: ServiceMode } {
  if (wantsLive("checkpointEvaluator")) {
    try {
      return { impl: buildLiveCheckpointEvaluator(), mode: "live" };
    } catch {
      warnFallback("checkpointEvaluator", "not_implemented");
    }
  } else if (!process.env.ANTHROPIC_API_KEY) {
    warnFallback("checkpointEvaluator", "no_api_key");
  }
  return { impl: new MockCheckpointEvaluator(), mode: "mock" };
}

export function getServices(): Services {
  const intentParser = buildIntentParser();
  const goalInterviewer = buildGoalInterviewer();
  const knowledgeProbe = buildKnowledgeProbe();
  const pathOutliner = buildPathOutliner();
  const checkpointEvaluator = buildCheckpointEvaluator();

  // The aggregate mode reports "live" only when every service is live. Mixed-mode (some
  // live, some mock) reports "mock" so the UI cannot accidentally claim guarantees a
  // mocked dependency can't honour. Per-service modes are an internal detail.
  const allLive =
    intentParser.mode === "live" &&
    goalInterviewer.mode === "live" &&
    knowledgeProbe.mode === "live" &&
    pathOutliner.mode === "live" &&
    checkpointEvaluator.mode === "live";

  return {
    intentParser: intentParser.impl,
    goalInterviewer: goalInterviewer.impl,
    knowledgeProbe: knowledgeProbe.impl,
    pathOutliner: pathOutliner.impl,
    checkpointEvaluator: checkpointEvaluator.impl,
    mode: allLive ? "live" : "mock",
  };
}
