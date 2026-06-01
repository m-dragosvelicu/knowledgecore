"use client";

import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import SubmitButton from "@/components/journey/SubmitButton";
import { Eyebrow } from "@/components/ui";

type Props = {
  stepId: string;
  // The resolved journey id (from ?j), submitted as a hidden field so the
  // action mutates and advances the journey the learner actually opened.
  intentId: string;
  action: (formData: FormData) => void | Promise<void>;
  // Server-rendered markdown content.
  content: React.ReactNode;
  /**
   * Minimum dwell before the learner can continue, in whole seconds. Supplied by
   * the server via the presenter seam (lib/journey/presenter.ts): the page asks
   * the active strategy for render directives and passes the paced dwell down.
   * Defaults to DEFAULT_DWELL_SECONDS so any caller that does not yet thread the
   * presenter through keeps today's behavior.
   */
  dwellSeconds?: number;
};

// Default minimum dwell before the learner can continue. A gentle gate (B.6 Q1):
// it signals that reading is the point, without being a hard lock that
// frustrates. The presenter seam can scale this via paceMultiplier; with the
// default pass-through strategy it stays 6s.
const DEFAULT_DWELL_SECONDS = 6;

// An approximate read time, shown in the eyebrow ("Read · about 4 min") the way
// the kit checkpoint does. Derived from the dwell, kept human and approximate so
// it never reads as a precise system measurement.
function approxReadMinutes(dwellSeconds: number): number {
  return Math.max(1, Math.round(dwellSeconds / 60) || 1);
}

/**
 * The Information surface (B.6 Q4): the calm READING half of a goalpost.
 *
 * Slice 4 restyle — this is the reading surface, tuned to the kit checkpoint as
 * the starting point: Hanken (NOT a serif), a calm reading size, a measure of
 * ~62ch, and a looser line-height than operational copy. The first paragraph of
 * the lesson reads as a "lead" (slightly larger, in full ink); the rest is
 * comfortable body in ink-2; blockquotes become teal-edged pull-quotes. Warm
 * paper surface, generous vertical rhythm. A short dwell gate keeps the continue
 * button disabled until the learner has plausibly read, or scrolled to the end.
 */
export default function InformationView({
  stepId,
  intentId,
  action,
  content,
  dwellSeconds = DEFAULT_DWELL_SECONDS,
}: Props) {
  const [remaining, setRemaining] = useState(dwellSeconds);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [remaining]);

  useEffect(() => {
    const el = endRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setScrolledToEnd(true);
      },
      { threshold: 0.5 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const ready = remaining <= 0 || scrolledToEnd;

  return (
    <Box
      sx={{
        bgcolor: "background.paper",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-sm)",
        p: { xs: "28px 24px", md: "48px 56px" },
      }}
    >
      <Stack spacing={4}>
        <Eyebrow>Read &middot; about {approxReadMinutes(dwellSeconds)} min</Eyebrow>

        <Box
          sx={{
            // Reading type (decided): Hanken — NOT a serif — tuned to the kit
            // checkpoint values: a calm reading size, a ~62ch measure, and a
            // looser line-height than operational copy. The lead paragraph reads
            // a touch larger in full ink; the body settles into ink-2.
            fontFamily: "var(--font-read)",
            maxWidth: "62ch",
            color: "var(--ink-2)",
            // Body paragraphs: the calm reading default.
            "& p": {
              fontSize: "17px",
              lineHeight: 1.75,
              my: "1.1em",
            },
            // The lead: first paragraph slightly larger and in full ink, so the
            // read opens with weight before it relaxes.
            "& > :first-of-type, & p:first-of-type": {
              color: "var(--ink)",
              fontSize: "18px",
              lineHeight: 1.7,
            },
            "& h1, & h2, & h3, & h4": {
              fontFamily: "var(--font-display)",
              fontVariationSettings: "var(--soft-ui)",
              fontWeight: 500,
              letterSpacing: "-.01em",
              color: "var(--ink)",
              lineHeight: 1.2,
              mt: "1.6em",
              mb: "0.5em",
            },
            "& h2": { fontSize: "23px" },
            "& h3": { fontSize: "19px" },
            "& ul, & ol": { pl: "1.3em", my: "1.1em" },
            "& li": { fontSize: "17px", lineHeight: 1.7, my: "0.4em" },
            "& strong": { color: "var(--ink)", fontWeight: 600 },
            "& a": { color: "var(--teal-deep)", textUnderlineOffset: "3px" },
            "& code": {
              fontSize: "0.92em",
              bgcolor: "var(--surface-2)",
              borderRadius: "6px",
              px: "0.4em",
              py: "0.1em",
            },
            // Blockquote -> pull-quote: a teal-edged aside in the reading voice,
            // matching the kit's `.pull`.
            "& blockquote": {
              m: "1.6em 0",
              pl: "1.1em",
              borderLeft: "3px solid var(--teal)",
              color: "var(--ink)",
              fontStyle: "italic",
              fontSize: "18px",
              lineHeight: 1.6,
            },
            "& img, & svg, & figure": { maxWidth: "100%" },
          }}
        >
          {content}
        </Box>

        <div ref={endRef} />

        <Box>
          <form action={action}>
            <input type="hidden" name="j" value={intentId} />
            <input type="hidden" name="stepId" value={stepId} />
            <SubmitButton
              variant="contained"
              color="kcInk"
              size="large"
              disabled={!ready}
              pendingLabel="Opening your build…"
            >
              {ready
                ? "I have read this. Now try it"
                : `Take a moment to read… (${remaining}s)`}
            </SubmitButton>
          </form>
        </Box>
      </Stack>
    </Box>
  );
}
