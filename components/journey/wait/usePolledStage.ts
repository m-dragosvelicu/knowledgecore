"use client";

// KnowledgeCore — generic staged-poll hook (T3), extracted from the original
// GettingReady effect (E04.S01 PRD sec. 5 move 1). Fires `start` once and
// polls `poll` on an interval until a terminal state, exposing
// {state, failed, retry}. Generic over any polled payload shaped like
// { status: "running" | "ready" | "failed" } — the coarse contract
// LessonGenerationState already uses — so future T3 callers (research-bundle
// fill, pre-generation path) can reuse this unchanged.

import { useEffect, useRef, useState } from "react";

export type PolledStageStatus = "running" | "ready" | "failed";

export type PolledStage = {
  status: PolledStageStatus;
};

export type UsePolledStageOptions = {
  /** Poll cadence in ms. Default 1000, matching the shipped lesson ladder. */
  intervalMs?: number;
  /** Called once a terminal "ready" state is confirmed (e.g. router.refresh()). */
  onReady?: () => void;
};

export type UsePolledStageResult<T extends PolledStage> = {
  state: T | null;
  failed: boolean;
  /** Resets and re-runs the effect — the "Try again" path. */
  retry: () => void;
};

/**
 * `start` runs the generation to completion (idempotent: resolves on success,
 * throws on failure). `poll` reads the live persisted state. Both take no
 * arguments — bind any ids via closure in the caller, and list every value
 * those closures depend on in `deps` (the same contract as useEffect's own
 * dependency list). `retry` bumps an internal counter to re-run the effect
 * without requiring a `deps` change.
 */
export function usePolledStage<T extends PolledStage>(
  start: () => Promise<void>,
  poll: () => Promise<T | null>,
  deps: unknown[],
  options: UsePolledStageOptions = {},
): UsePolledStageResult<T> {
  const { intervalMs = 1000 } = options;
  const [state, setState] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Always call the latest onReady without forcing it into the effect's deps
  // (it usually closes over things like `router` that the caller should not
  // have to thread through `deps`).
  const onReadyRef = useRef(options.onReady);
  onReadyRef.current = options.onReady;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const stop = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const tick = async () => {
      try {
        const next = await poll();
        if (cancelled) return;
        if (next) {
          setState(next);
          if (next.status === "ready") {
            stop();
            onReadyRef.current?.();
            return;
          }
          if (next.status === "failed") {
            stop();
            setFailed(true);
            return;
          }
        }
      } catch {
        // A transient poll error is non-fatal; `start`'s resolution is the
        // authoritative success/failure signal, so keep polling.
      }
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    };

    (async () => {
      try {
        await start();
        if (cancelled) return;
        // One authoritative read so we resolve promptly even if the next
        // scheduled poll has not fired yet.
        const finalState = await poll();
        if (cancelled) return;
        if (finalState?.status === "failed") {
          stop();
          setState(finalState);
          setFailed(true);
        } else {
          stop();
          onReadyRef.current?.();
        }
      } catch {
        if (cancelled) return;
        stop();
        setFailed(true);
      }
    })();

    timer = setTimeout(tick, intervalMs);

    return () => {
      cancelled = true;
      stop();
    };
    // `deps` is the caller-declared dependency list (mirrors useEffect); this
    // hook cannot statically know its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt, intervalMs]);

  const retry = () => {
    setFailed(false);
    setState(null);
    setAttempt((a) => a + 1);
  };

  return { state, failed, retry };
}
