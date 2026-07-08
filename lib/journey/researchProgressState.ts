/**
 * The generation-state record the research-fill ladder polls (E04.S03). A
 * server action cannot stream sub-steps, so `fillBundle` writes its current
 * stage onto `ResearchBundle.progress` and the client polls it — the same
 * shape of contract as `lib/journey/lessonGenerationState.ts`, adapted to the
 * research-bundle pipeline (search -> per-source read -> best-effort index).
 */

import type { ResearchProgressEvent } from "@/lib/services/research";

/** The ordered stages `fillBundle` passes through. */
export type ResearchStage =
  | "searching" // Tavily / academic search in flight, no hits yet
  | "reading" // per-source extraction (done/total advances here)
  | "indexing" // best-effort embedding + Qdrant upsert (E01.S09)
  | "ready" // terminal success: the bundle is usable for grounding
  | "failed"; // terminal failure: fillBundle threw; journey stays ungrounded

export type ResearchRunStatus = "running" | "ready" | "failed";

/**
 * The polled record. `done`/`total` drive a "reading sources (3 of 8)" style
 * readout during the `reading` stage; `label` is a human-readable current-stage
 * line; `status` is the coarse terminal/in-flight flag the client branches on.
 */
export type ResearchProgressState = {
  stage: ResearchStage;
  label: string;
  done: number;
  total: number;
  status: ResearchRunStatus;
  updatedAt: string;
};

/** A short, human-readable label for each stage (default progress copy). */
export function defaultLabelForResearchStage(
  stage: ResearchStage,
  done = 0,
  total = 0,
): string {
  switch (stage) {
    case "searching":
      return "Searching the open web";
    case "reading":
      // done = completed extractions; the label names the one in progress
      // (same clamp convention as lessonGenerationState's composing label).
      return total > 0
        ? `Reading sources (${Math.min(done + 1, total)} of ${total})`
        : "Reading sources";
    case "indexing":
      return "Indexing for your Library";
    case "ready":
      return "Ready";
    case "failed":
      return "We could not gather sources just now";
  }
}

/** Map a stage to the coarse run status the client branches on. */
export function statusForResearchStage(stage: ResearchStage): ResearchRunStatus {
  if (stage === "ready") return "ready";
  if (stage === "failed") return "failed";
  return "running";
}

/** Build a state record for a stage, filling label + status by default. */
export function makeResearchProgressState(
  stage: ResearchStage,
  partial: { label?: string; done?: number; total?: number } = {},
): ResearchProgressState {
  const done = partial.done ?? 0;
  const total = partial.total ?? 0;
  return {
    stage,
    label: partial.label ?? defaultLabelForResearchStage(stage, done, total),
    done,
    total,
    status: statusForResearchStage(stage),
    updatedAt: new Date().toISOString(),
  };
}

/** Map a ResearchAgent progress event onto a persistable state record. */
export function stateForResearchEvent(event: ResearchProgressEvent): ResearchProgressState {
  if (event.phase === "searching") return makeResearchProgressState("searching");
  return makeResearchProgressState("reading", { done: event.done, total: event.total });
}

/** Structural guard for reading the persisted `ResearchBundle.progress` Json back. */
export function isResearchProgressState(value: unknown): value is ResearchProgressState {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.stage === "string" &&
    typeof o.label === "string" &&
    typeof o.done === "number" &&
    typeof o.total === "number" &&
    (o.status === "running" || o.status === "ready" || o.status === "failed")
  );
}
