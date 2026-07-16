"use client";

import { useRouter } from "next/navigation";
import { usePolledStage } from "@/components/journey/wait/usePolledStage";
import StagedWait from "@/components/journey/wait/StagedWait";
import type { ProbeResumeState } from "@/lib/journey/probeState";

type Props = {
  intentId: string;
  action: (intentId?: string | null) => Promise<void>;
  pollAction: (intentId?: string | null) => Promise<ProbeResumeState | null>;
};

const POLL_INTERVAL_MS = 1000;

// The probe-questions call has no sub-stages to poll (a single blocking
// structured call, unlike the lesson pipeline's multi-phase ladder), so this
// renders a single active step rather than inventing stages that do not map
// to real progress. Same wiring shape as GettingReady.tsx: usePolledStage
// owns the kickoff+poll state machine, StagedWait renders it.
export default function ProbeWait({ intentId, action, pollAction }: Props) {
  const router = useRouter();

  // The raw `error` field on a failed poll is an internal exception message
  // (e.g. from the LLM client), not user-facing copy — GettingReady shows a
  // curated message on failure rather than that raw string, so this mirrors
  // that and does not read `state` at all.
  const { failed, retry } = usePolledStage<ProbeResumeState>(
    () => action(intentId),
    () => pollAction(intentId),
    [intentId, action, pollAction],
    { intervalMs: POLL_INTERVAL_MS, onReady: () => router.refresh() },
  );

  if (failed) {
    return (
      <StagedWait
        failed
        failureHeadline="We could not prepare your questions just now"
        failureDetail="This sometimes happens on a busy connection. You can try again."
        onRetry={retry}
      />
    );
  }

  // Headline is deliberately distinct from the page's own "Finding your
  // starting point" eyebrow above it, to avoid repeating the same phrase
  // twice on screen.
  return (
    <StagedWait
      headline="Shaping your first few questions"
      stageCount={1}
      activeIndex={0}
      label="Preparing your questions"
      detail="This takes a moment while we put together a few quick questions to calibrate where your trail begins."
    />
  );
}
