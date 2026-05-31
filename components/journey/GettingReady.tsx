"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import SolidButton from "@/components/ui/SolidButton";
import { Eyebrow, HeadlineUnderline } from "@/components/ui";

type Props = {
  goalpostId: string;
  title: string;
  /**
   * Server action that generates (Call B) and persists this goalpost's lesson
   * content against the freshest learner profile. Idempotent.
   */
  action: (goalpostId: string) => Promise<void>;
};

/**
 * L1 LAZY GENERATION — the "getting things ready" screen.
 *
 * Shown when a learner enters a goalpost whose lesson content has not yet been
 * generated (Call B). On mount it invokes the server action to author the
 * profile-adapted content, then refreshes the route so the page re-renders with
 * the ready lesson. The common case is pre-generated on advance, so this screen
 * is brief or skipped entirely; it is the honest cover for the first goalpost and
 * any pre-generation miss.
 *
 * Slice 4 restyle: warm paper surface, no SaaS spinner. The wait is carried by a
 * single quiet draw-in motif (the same self-drawing hand as the headline
 * underline) and a Fraunces line, so it reads as the product taking a calm beat
 * rather than a system loading. Retry/error path unchanged.
 */
export default function GettingReady({ goalpostId, title, action }: Props) {
  const router = useRouter();
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        await action(goalpostId);
        if (!cancelled) router.refresh();
      } catch {
        if (!cancelled) {
          setError("We could not prepare this goalpost just now.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [action, goalpostId, router]);

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
      {error ? (
        <Stack spacing={3} alignItems="flex-start">
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
            {error}
          </Box>
          <SolidButton
            tone="ink"
            arrow={false}
            onClick={() => {
              startedRef.current = false;
              setError(null);
              router.refresh();
            }}
          >
            Try again
          </SolidButton>
        </Stack>
      ) : (
        <Stack spacing={3} alignItems="flex-start" aria-live="polite">
          <Eyebrow>Getting things ready</Eyebrow>

          {/* The one quiet, one-shot motion: a hand drawing a short trail in.
              Not a looping spinner — it arrives once and rests, the same hand
              as every other mark in the product. */}
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

          <Box
            sx={{
              fontFamily: "var(--font-read)",
              fontSize: 15.5,
              lineHeight: 1.6,
              color: "var(--ink-2)",
              maxWidth: "52ch",
            }}
          >
            Tailoring &ldquo;{title}&rdquo; to where you are right now. This takes
            a few seconds.
          </Box>
        </Stack>
      )}
    </Box>
  );
}
