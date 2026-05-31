"use client";

import { useEffect, useRef, useState } from "react";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import SubmitButton from "@/components/journey/SubmitButton";

type Props = {
  stepId: string;
  action: (formData: FormData) => void | Promise<void>;
  // Server-rendered markdown content.
  content: React.ReactNode;
};

// Minimum dwell before the learner can continue. A gentle gate (B.6 Q1): it
// signals that reading is the point, without being a hard lock that frustrates.
const DWELL_SECONDS = 6;

/**
 * The Information surface (B.6 Q4): a calm, reading-oriented mode visually
 * distinct from the Experience surface. A short dwell gate keeps the continue
 * button disabled until the learner has plausibly read the material, or has
 * scrolled to the end of it.
 */
export default function InformationView({ stepId, action, content }: Props) {
  const [remaining, setRemaining] = useState(DWELL_SECONDS);
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
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 3, md: 5 },
        bgcolor: "#fbfaf7",
        borderRadius: 2,
      }}
    >
      <Stack spacing={3}>
        <Typography
          variant="overline"
          sx={{ letterSpacing: 2, color: "text.secondary" }}
        >
          Read &middot; Information
        </Typography>
        <Box
          sx={{
            // Reading-optimized: serif body, generous measure and line-height.
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: "1.075rem",
            lineHeight: 1.75,
            maxWidth: "62ch",
            "& p": { my: 1.5 },
          }}
        >
          {content}
        </Box>
        <div ref={endRef} />
        <Box>
          <form action={action}>
            <input type="hidden" name="stepId" value={stepId} />
            <SubmitButton
              variant="contained"
              size="large"
              disabled={!ready}
              pendingLabel="Loading your experience…"
            >
              {ready
                ? "I have read this — continue to the experience"
                : `Take a moment to read… (${remaining}s)`}
            </SubmitButton>
          </form>
        </Box>
      </Stack>
    </Paper>
  );
}
