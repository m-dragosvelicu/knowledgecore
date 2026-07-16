"use client";

// KnowledgeCore — staged-wait presentational primitive (T3), extracted
// verbatim from the original GettingReady screen (E04.S01 PRD sec. 5 move 1).
// Draws the honest dot ladder + indeterminate sweep for a real, persisted
// multi-stage pipeline, plus the shared failure/retry state. Purely
// presentational: a caller (typically via usePolledStage) owns polling and
// stage derivation; this component only renders what it is given.

import type { ReactNode } from "react";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import SolidButton from "@/components/ui/SolidButton";
import { Eyebrow, HeadlineUnderline } from "@/components/ui";

type Props = {
  /** True renders the failure branch instead of the ladder. */
  failed?: boolean;

  // --- running/ready branch ---
  eyebrow?: ReactNode;
  headline?: ReactNode;
  /** Number of dots in the ladder. */
  stageCount?: number;
  /** Index (0-based) of the currently active dot. */
  activeIndex?: number;
  /** Plain-text current-stage line, also used verbatim as aria-label. */
  label?: string;
  /** Visible current-stage line under the ladder; defaults to `label`. */
  displayLabel?: ReactNode;
  /** Supporting copy under the sweep. */
  detail?: ReactNode;

  // --- failure branch ---
  failureEyebrow?: ReactNode;
  failureHeadline?: ReactNode;
  failureDetail?: ReactNode;
  retryLabel?: ReactNode;
  onRetry?: () => void;
};

const CARD_SX = {
  bgcolor: "background.paper",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-lg)",
  boxShadow: "var(--shadow-sm)",
  p: { xs: "40px 28px", md: "60px 56px" },
} as const;

export default function StagedWait({
  failed = false,
  eyebrow = "Getting things ready",
  headline,
  stageCount = 0,
  activeIndex = 0,
  label = "",
  displayLabel,
  detail,
  failureEyebrow = "Something got in the way",
  failureHeadline,
  failureDetail,
  retryLabel = "Try again",
  onRetry,
}: Props) {
  if (failed) {
    return (
      <Box className="kc-fade" sx={CARD_SX}>
        <Stack spacing={3} alignItems="flex-start" aria-live="polite">
          <Eyebrow>{failureEyebrow}</Eyebrow>
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
            {failureHeadline}
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
            {failureDetail}
          </Box>
          <SolidButton tone="ink" arrow={false} onClick={onRetry}>
            {retryLabel}
          </SolidButton>
        </Stack>
      </Box>
    );
  }

  return (
    <Box className="kc-fade" sx={CARD_SX}>
      <Stack spacing={3} alignItems="flex-start" aria-live="polite">
        <Eyebrow>{eyebrow}</Eyebrow>

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
            {headline}
          </Box>
        </HeadlineUnderline>

        {/* Stage ladder: filled ticks + label carry progress, not color alone (a11y). */}
        <Box
          className="kc-progress"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={stageCount}
          aria-valuenow={activeIndex + 1}
        >
          {Array.from({ length: stageCount }, (_, i) => (
            <Box
              key={i}
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
          {displayLabel ?? label}
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
          {detail}
        </Box>
      </Stack>
    </Box>
  );
}
