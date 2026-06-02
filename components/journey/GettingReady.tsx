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
  // The resolved journey id (from ?j), forwarded to the actions so generation
  // runs (and polls) against the journey the learner actually opened.
  intentId: string;
  title: string;
  /**
   * Server action that runs the orchestrator to completion (Phase 1 author +
   * Phase 2 visual workers + assemble + persist). Idempotent. We kick it off on
   * mount; it returns when generation is fully done (or throws on a hard failure).
   */
  action: (goalpostId: string, intentId?: string | null) => Promise<void>;
  /**
   * Server action that reads the orchestrator's live generation-state record
   * (redesign §8). Polled ~1s so the screen shows honest staged progress and a
   * real terminal state (ready -> reveal, failed -> error + Try again) instead of
   * a one-shot loader that freezes or a silent refresh loop.
   */
  pollAction: (
    goalpostId: string,
    intentId?: string | null,
  ) => Promise<LessonGenerationState | null>;
};

// The visible stage ladder (queued folds into "starting"). The active stage's
// tick pulses; earlier ticks are filled; later ticks are empty. This is the
// genuinely-live progress: it advances as the orchestrator advances, so the wait
// never reads as frozen across the ~40-50s cold-miss window.
const STAGE_LADDER: GenerationStage[] = [
  "authoring",
  "composing",
  "assembling",
  "ready",
];

function ladderIndex(stage: GenerationStage): number {
  if (stage === "queued") return 0; // not yet authoring -> sit at the first tick
  const i = STAGE_LADDER.indexOf(stage);
  return i < 0 ? 0 : i;
}

const POLL_INTERVAL_MS = 1000;

/**
 * L1 — Two-Phase Visual Lesson Pipeline (Slice 4): the staged-progress screen.
 *
 * Replaces the one-shot 1.6s loader that froze after the animation finished and
 * (because generation used to fail silently) looped forever on refresh. This
 * screen POLLS the orchestrator's real generation-state (redesign §8):
 *
 *   - On mount: kick off generation (`action`, runs the orchestrator to
 *     completion) AND start polling `pollAction` every ~1s.
 *   - While running: show the live `label` ("Structuring the lesson",
 *     "Composing visuals (1 of 2)", "Putting it together") with REAL, continuous
 *     motion -- a stage ladder that fills as stages advance, a pulsing active
 *     tick, and an indeterminate sweep -- so it never reads as frozen.
 *   - On status "ready": router.refresh() to reveal the complete lesson.
 *   - On status "failed": a real error message + a keyboard-focusable "Try again"
 *     that re-triggers generation. NEVER an invisible refresh loop.
 *   - Polling stops on any terminal state and on unmount.
 *
 * Accessibility: the status region is aria-live="polite"; "Try again" is a real
 * focusable button; progress meaning is carried by the stage label + filled ticks
 * (text + position), not by color alone; motion respects prefers-reduced-motion
 * (the loops resolve to a static in-progress state in globals.css).
 */
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
        // A transient poll error is non-fatal -- the generation action below is
        // the authoritative success/failure signal; keep polling.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    // Kick off generation (runs the orchestrator to completion). When it
    // resolves the record is "ready"; when it throws the record is "failed" (or
    // we mark failure here as a backstop so the learner is never stuck behind a
    // silent refresh loop).
    (async () => {
      try {
        await action(goalpostId, intentId);
        if (cancelled) return;
        // Generation finished: take one authoritative read so we reveal promptly
        // even if the next scheduled poll has not fired yet.
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

    // Poll in parallel for live staged progress while generation runs.
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

  // -------------------------------------------------------------------------
  // Failed: honest error + Try again. No invisible refresh loop.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Running: live staged progress.
  // -------------------------------------------------------------------------
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

        {/* The draw-in flourish: the same self-drawing hand as every mark, kept
            as a one-time grace note. It is NOT the only motion -- the live cues
            below carry the honest in-progress signal. */}
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

        {/* The live stage ladder: ticks before the active stage fill teal, the
            active stage pulses, later stages stay empty. Honest, position-coded
            progress -- not color alone (the label below names the same stage). */}
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

        {/* The current stage, in words -- the honest "where you are" line. */}
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

        {/* The indeterminate sweep: continuous motion between poll ticks so the
            wait never reads as frozen even if a stage runs long (one SVG worker
            measured ~50s). */}
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
