"use client";

import { useRouter } from "next/navigation";
import { usePolledStage } from "@/components/journey/wait/usePolledStage";
import StagedWait from "@/components/journey/wait/StagedWait";
import {
  defaultLabelForStage,
  type GenerationStage,
  type LessonGenerationState,
} from "@/lib/journey/lesson/generationState";

type Props = {
  goalpostId: string;
  intentId: string;
  title: string;
  // Runs the orchestrator to completion (idempotent); resolves when ready, throws on failure.
  action: (goalpostId: string, intentId?: string | null) => Promise<void>;
  // Reads the live generation-state record (redesign §8); polled ~1s for staged progress.
  pollAction: (
    goalpostId: string,
    intentId?: string | null,
  ) => Promise<LessonGenerationState | null>;
};

// Visible stage ladder (queued folds into the first tick).
const STAGE_LADDER: GenerationStage[] = [
  "authoring",
  "composing",
  "assembling",
  "ready",
];

function ladderIndex(stage: GenerationStage): number {
  if (stage === "queued") return 0;
  const i = STAGE_LADDER.indexOf(stage);
  return i < 0 ? 0 : i;
}

const POLL_INTERVAL_MS = 1000;

// Thin consumer of the shared T3 wait primitives: usePolledStage drives the
// start+poll state machine, StagedWait renders the ladder/sweep/failure UI.
export default function GettingReady({
  goalpostId,
  intentId,
  title,
  action,
  pollAction,
}: Props) {
  const router = useRouter();

  const { state, failed, retry } = usePolledStage<LessonGenerationState>(
    () => action(goalpostId, intentId),
    () => pollAction(goalpostId, intentId),
    [goalpostId, intentId, action, pollAction],
    { intervalMs: POLL_INTERVAL_MS, onReady: () => router.refresh() },
  );

  if (failed) {
    const message =
      state?.label && state.status === "failed"
        ? state.label
        : "We could not prepare this goalpost just now.";
    return (
      <StagedWait
        failed
        failureHeadline={message}
        failureDetail={
          <>
            Preparing &ldquo;{title}&rdquo; did not finish. This sometimes
            happens on a busy connection. You can try again.
          </>
        }
        onRetry={retry}
      />
    );
  }

  const stage: GenerationStage = state?.stage ?? "queued";
  const label =
    state?.label ?? defaultLabelForStage("queued", state?.done ?? 0, state?.total ?? 0);
  const activeIndex = ladderIndex(stage);

  return (
    <StagedWait
      headline="Shaping this goalpost for you"
      stageCount={STAGE_LADDER.length}
      activeIndex={activeIndex}
      label={label}
      displayLabel={
        <>
          {label}
          {stage === "composing" && state && state.total > 0 ? "…" : ""}
        </>
      }
      detail={
        <>
          Tailoring &ldquo;{title}&rdquo; to where you are right now. This can
          take up to a minute when there are visuals to compose.
        </>
      }
    />
  );
}
