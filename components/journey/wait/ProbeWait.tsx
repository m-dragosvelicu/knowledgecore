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

// Single blocking call, no sub-stages to poll — renders one active step
// rather than inventing stages that don't map to real progress. Same wiring
// shape as GettingReady.tsx.
export default function ProbeWait({ intentId, action, pollAction }: Props) {
  const router = useRouter();

  // `error` on a failed poll is an internal exception message, not
  // user-facing copy, so it's intentionally not read here.
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
