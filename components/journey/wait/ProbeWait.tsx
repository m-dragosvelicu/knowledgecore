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

// Backend slice placeholder: the probe questions call has no sub-stages (a
// single blocking structured call, unlike the lesson pipeline GettingReady
// ladder-tracks), so this is intentionally a single-dot wait, not a ladder.
// Thin wrapper over the shared T3 primitives (usePolledStage + StagedWait),
// same wiring shape as GettingReady.tsx; the frontend engineer owns final
// copy/visuals and may replace this component outright.
export default function ProbeWait({ intentId, action, pollAction }: Props) {
  const router = useRouter();

  const { state, failed, retry } = usePolledStage<ProbeResumeState>(
    () => action(intentId),
    () => pollAction(intentId),
    [intentId, action, pollAction],
    { intervalMs: POLL_INTERVAL_MS, onReady: () => router.refresh() },
  );

  if (failed) {
    return (
      <StagedWait
        failed
        failureHeadline="We could not prepare your questions just now."
        failureDetail="This sometimes happens on a busy connection. You can try again."
        onRetry={retry}
      />
    );
  }

  return (
    <StagedWait
      headline="Finding your starting point"
      stageCount={1}
      activeIndex={0}
      label="Preparing your questions"
      detail="This takes a moment while we shape a few quick questions to calibrate where your trail begins."
    />
  );
}
