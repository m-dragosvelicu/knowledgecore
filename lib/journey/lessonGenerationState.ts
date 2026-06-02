/**
 * The generation-state record the GettingReady screen polls. A server action
 * cannot stream sub-steps, so the orchestrator writes its stage here and the
 * client polls it; a `failed` stage surfaces as a real error instead of looping.
 * Stored inside the information Step's `payload` (one key in the existing Json
 * column, no migration; the step is 1:1 with the goalpost).
 */

/** The ordered stages the orchestrator passes through. */
export type GenerationStage =
  | "queued" // accepted, not yet started authoring
  | "authoring" // Phase 1: structuring the lesson
  | "composing" // Phase 2: resolving visuals (done/total advances here)
  | "assembling" // substitute payloads, drop dropped slots, persist
  | "ready" // terminal success: a complete LessonDoc is persisted
  | "failed"; // terminal failure: no usable LessonDoc

export type GenerationRunStatus = "running" | "ready" | "failed";

/**
 * The polled record. `done`/`total` drive a "composing diagram (1/2)" style
 * progress readout; `label` is a human-readable line for the current stage;
 * `status` is the coarse terminal/in-flight flag the client branches on.
 */
export type LessonGenerationState = {
  /** The fine-grained stage (for richer UI if Slice 4 wants it). */
  stage: GenerationStage;
  /** Human-readable current-stage line, e.g. "Composing diagram 1 of 2". */
  label: string;
  /** Visuals resolved so far (composing stage); 0 before fan-out. */
  done: number;
  /** Total visuals to resolve (composing stage); 0 before fan-out. */
  total: number;
  /** Coarse flag the client branches on: keep polling | render | show error. */
  status: GenerationRunStatus;
  /** ISO timestamp of the last write (staleness / debugging). */
  updatedAt: string;
};

/** A short, human-readable label for each stage (default progress copy). */
export function defaultLabelForStage(
  stage: GenerationStage,
  done = 0,
  total = 0,
): string {
  switch (stage) {
    case "queued":
      return "Getting things ready";
    case "authoring":
      return "Structuring the lesson";
    case "composing":
      return total > 0
        ? `Composing visuals (${Math.min(done + 1, total)} of ${total})`
        : "Composing visuals";
    case "assembling":
      return "Putting it together";
    case "ready":
      return "Ready";
    case "failed":
      return "We could not prepare this goalpost just now";
  }
}

/** Map a stage to the coarse run status the client branches on. */
export function statusForStage(stage: GenerationStage): GenerationRunStatus {
  if (stage === "ready") return "ready";
  if (stage === "failed") return "failed";
  return "running";
}

/** Build a state record for a stage, filling label + status by default. */
export function makeGenerationState(
  stage: GenerationStage,
  partial: { label?: string; done?: number; total?: number } = {},
): LessonGenerationState {
  const done = partial.done ?? 0;
  const total = partial.total ?? 0;
  return {
    stage,
    label: partial.label ?? defaultLabelForStage(stage, done, total),
    done,
    total,
    status: statusForStage(stage),
    updatedAt: new Date().toISOString(),
  };
}
