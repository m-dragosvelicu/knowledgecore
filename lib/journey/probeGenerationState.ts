/**
 * The generation-state record the probe wait screen polls. Mirrors
 * lessonGenerationState.ts's contract (status/label/error, client polls,
 * `failed` surfaces as a real error instead of looping). The probe-questions
 * call has no sub-stages to report — a single blocking structured call, unlike
 * the lesson's multi-phase pipeline — so there is no stage ladder here, only
 * the coarse run status.
 */

/** The coarse run status the client branches on (same contract as PolledStage). */
export type ProbeRunStatus = "running" | "ready" | "failed";

export type ProbeGenerationState = {
  status: ProbeRunStatus;
  label: string;
  error: string | null;
  updatedAt: string;
};

function defaultLabelForStatus(status: ProbeRunStatus): string {
  switch (status) {
    case "running":
      return "Preparing your questions";
    case "ready":
      return "Ready";
    case "failed":
      return "We could not prepare your questions just now";
  }
}

/** Build a state record for a status, filling label by default. */
export function makeProbeGenerationState(
  status: ProbeRunStatus,
  partial: { label?: string; error?: string | null } = {},
): ProbeGenerationState {
  return {
    status,
    label: partial.label ?? defaultLabelForStatus(status),
    error: partial.error ?? null,
    updatedAt: new Date().toISOString(),
  };
}

/** Type guard for reading the Json column back off a ProbeState row. */
export function isProbeGenerationState(v: unknown): v is ProbeGenerationState {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as ProbeGenerationState).status === "string"
  );
}
