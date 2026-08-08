"use client";

// Research-fill T3 ladder (E04.S03): fills a ResearchBundle on cache MISS
// inside acceptPathAction. Mounted by both commit surfaces
// (PathConfirmationGate, BeginClient) so it exists exactly once.
//
// Cache-HIT short-circuit: only shown once a poll reports a RUNNING fill;
// until then `children` (caller's pending UI) stays up so a near-instant HIT
// never flashes the ladder. A fill failure is best-effort (journey proceeds
// ungrounded); only a failed accept action itself gets the hard Try-again branch.

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { usePolledStage } from "@/components/journey/wait/usePolledStage";
import StagedWait from "@/components/journey/wait/StagedWait";
import {
  acceptPathAction,
  readBundleProgressAction,
} from "@/app/(app)/journey/_actions";
import type {
  ResearchProgressState,
  ResearchStage,
} from "@/lib/journey/research/progressState";

// Visible stage ladder (failed branches to the failure card instead).
const STAGE_LADDER: ResearchStage[] = [
  "searching",
  "reading",
  "indexing",
  "ready",
];

function ladderIndex(stage: ResearchStage): number {
  const i = STAGE_LADDER.indexOf(stage);
  return i < 0 ? 0 : i;
}

type Props = {
  // The journey being accepted; the only id the client has (the bundle is
  // created server-side inside acceptPathAction).
  intentId: string;
  // The caller's own pending UI, kept up until a running fill is observed.
  children: ReactNode;
};

export default function ResearchFillWait({ intentId, children }: Props) {
  const router = useRouter();
  const [sawRunning, setSawRunning] = useState(false);

  const { state, failed, retry } = usePolledStage<ResearchProgressState>(
    () => acceptPathAction(intentId),
    () => readBundleProgressAction(intentId),
    [intentId],
    // No onReady: acceptPathAction's own redirect carries the navigation.
  );

  useEffect(() => {
    if (state?.status === "running") setSawRunning(true);
  }, [state]);

  if (failed) {
    if (state?.status === "failed") {
      return (
        <StagedWait
          failed
          failureEyebrow="One thing to know"
          failureHeadline="Continuing without extra sources"
          failureDetail={
            <>
              We could not gather new sources just now, so this trail will draw
              on the model&rsquo;s own knowledge instead of a fresh Library.
              Nothing is lost &mdash; you can keep going.
            </>
          }
          retryLabel="Continue"
          onRetry={() => router.push(`/journey/goalpost?j=${intentId}`)}
        />
      );
    }
    return (
      <StagedWait
        failed
        failureHeadline="We could not start your trail just now"
        failureDetail={
          <>
            Starting your journey did not finish. This sometimes happens on a
            busy connection. You can try again.
          </>
        }
        onRetry={retry}
      />
    );
  }

  if (!sawRunning) return <>{children}</>;

  const stage: ResearchStage = state?.stage ?? "searching";
  return (
    <StagedWait
      headline="Building your Library for this trail"
      stageCount={STAGE_LADDER.length}
      activeIndex={ladderIndex(stage)}
      label={state?.label ?? "Searching the open web"}
      detail={
        <>
          Gathering the clearest explanations from the open web so this trail is
          grounded in real sources. This can take up to a minute on a fresh
          topic.
        </>
      }
    />
  );
}
