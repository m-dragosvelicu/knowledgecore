"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import SolidButton from "@/components/ui/SolidButton";
import { Eyebrow, HeadlineUnderline } from "@/components/ui";
import {
  defaultLabelForStage,
  type GenerationStage,
  type LessonGenerationState,
} from "@/lib/journey/lessonGenerationState";

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

// Staged-progress screen for the lazy-generation wait. On mount it kicks off
// generation and polls live state; reveals on "ready", shows error + Try again
// on "failed". Polling stops on any terminal state and on unmount.
export default function GettingReady({
  goalpostId,
  intentId,
  title,
  action,
  pollAction,
}: Props) {
  const router = useRouter();
  const [state, setState] = useState<LessonGenerationState | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumping this re-runs the generate+poll effect: the "Try again" path.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const stop = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const poll = async () => {
      try {
        const next = await pollAction(goalpostId, intentId);
        if (cancelled) return;
        if (next) {
          setState(next);
          if (next.status === "ready") {
            stop();
            // The complete LessonDoc is persisted -> reveal it.
            router.refresh();
            return;
          }
          if (next.status === "failed") {
            stop();
            setFailed(true);
            return;
          }
        }
      } catch {
        // A transient poll error is non-fatal; the generation action is the
        // authoritative success/failure signal, so keep polling.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    (async () => {
      try {
        await action(goalpostId, intentId);
        if (cancelled) return;
        // One authoritative read so we reveal promptly even if the next scheduled
        // poll has not fired yet.
        const finalState = await pollAction(goalpostId, intentId);
        if (cancelled) return;
        if (finalState?.status === "failed") {
          stop();
          setState(finalState);
          setFailed(true);
        } else {
          stop();
          router.refresh();
        }
      } catch {
        if (cancelled) return;
        stop();
        setFailed(true);
      }
    })();

    timer = setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      stop();
    };
  }, [action, pollAction, goalpostId, intentId, router, attempt]);

  const retry = () => {
    setFailed(false);
    setState(null);
    setAttempt((a) => a + 1);
  };

  if (failed) {
    const message =
      state?.label && state.status === "failed"
        ? state.label
        : "We could not prepare this goalpost just now.";
    return (
      <Box
        className="kc-fade"
        sx={{
          bgcolor: "background.paper",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-lg)",
          boxShadow: "var(--shadow-sm)",
          p: { xs: "40px 28px", md: "60px 56px" },
        }}
      >
        <Stack spacing={3} alignItems="flex-start" aria-live="polite">
          <Eyebrow>Something got in the way</Eyebrow>
          <Box
            sx={{
              fontFamily: "var(--font-display)",
              fontVariationSettings: "var(--soft-ui)",
              fontWeight: 500,
              fontSize: "clamp(20px, 2.6vw, 26px)",
              lineHeight: 1.2,
              letterSpacing: "-.01em",
              color: "var(--ink)",
            }}
          >
            {message}
          </Box>
          <Box
            sx={{
              fontFamily: "var(--font-read)",
              fontSize: 15.5,
              lineHeight: 1.6,
              color: "var(--ink-2)",
              maxWidth: "52ch",
            }}
          >
            Preparing &ldquo;{title}&rdquo; did not finish. This sometimes happens
            on a busy connection. You can try again.
          </Box>
          <SolidButton tone="ink" arrow={false} onClick={retry}>
            Try again
          </SolidButton>
        </Stack>
      </Box>
    );
  }

  const stage: GenerationStage = state?.stage ?? "queued";
  const label =
    state?.label ?? defaultLabelForStage("queued", state?.done ?? 0, state?.total ?? 0);
  const activeIndex = ladderIndex(stage);

  return (
    <Box
      className="kc-fade"
      sx={{
        bgcolor: "background.paper",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-sm)",
        p: { xs: "40px 28px", md: "60px 56px" },
      }}
    >
      <Stack spacing={3} alignItems="flex-start" aria-live="polite">
        <Eyebrow>Getting things ready</Eyebrow>

        {/* One-time draw-in flourish; the live cues below carry the in-progress signal. */}
        <Box
          component="svg"
          viewBox="0 0 200 24"
          aria-hidden="true"
          sx={{
            width: 200,
            height: 24,
            overflow: "visible",
            filter: "url(#rough)",
          }}
        >
          <path
            className="kc-draw"
            pathLength={1}
            d="M4 14 C 40 6, 70 20, 104 12 S 168 6, 196 13"
            fill="none"
            stroke="var(--teal)"
            strokeWidth={2.4}
            strokeLinecap="round"
            style={{ animationDuration: "1.6s" }}
          />
        </Box>

        <HeadlineUnderline>
          <Box
            component="span"
            sx={{
              fontFamily: "var(--font-display)",
              fontVariationSettings: "var(--soft-ui)",
              fontWeight: 500,
              fontSize: "clamp(22px, 3vw, 30px)",
              lineHeight: 1.16,
              letterSpacing: "-.01em",
              color: "var(--ink)",
            }}
          >
            Shaping this goalpost for you
          </Box>
        </HeadlineUnderline>

        {/* Stage ladder: filled ticks + label carry progress, not color alone (a11y). */}
        <Box
          className="kc-progress"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={STAGE_LADDER.length}
          aria-valuenow={activeIndex + 1}
        >
          {STAGE_LADDER.map((s, i) => (
            <Box
              key={s}
              className={[
                "kc-pdot",
                i < activeIndex ? "on" : "",
                i === activeIndex ? "active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            />
          ))}
        </Box>

        <Box
          sx={{
            fontFamily: "var(--font-read)",
            fontSize: 15.5,
            lineHeight: 1.6,
            color: "var(--ink)",
            fontWeight: 500,
          }}
        >
          {label}
          {stage === "composing" && state && state.total > 0 ? "…" : ""}
        </Box>

        {/* Indeterminate sweep: continuous motion between poll ticks so a long
            stage never reads as frozen. */}
        <Box className="kc-working" aria-hidden="true" />

        <Box
          sx={{
            fontFamily: "var(--font-read)",
            fontSize: 15.5,
            lineHeight: 1.6,
            color: "var(--ink-2)",
            maxWidth: "52ch",
          }}
        >
          Tailoring &ldquo;{title}&rdquo; to where you are right now. This can take
          up to a minute when there are visuals to compose.
        </Box>
      </Stack>
    </Box>
  );
}
