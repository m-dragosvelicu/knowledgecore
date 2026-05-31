"use client";

import { useState, useTransition } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import type { ResolvedVisual } from "@/lib/services/visualMedia";

/**
 * L1 Slice 4 — the ONE component that renders whichever medium the gate chose:
 * a sanitized SVG, a license-clean attributed image, or a reference video embed.
 * Build once, route at the data layer, render here.
 *
 * SECURITY: an `svg` ResolvedVisual has ALREADY passed the dedicated SVG
 * sanitizer (lib/services/visual/svgSanitizer.ts) on the SERVER before it reaches
 * this component. That is the ONLY reason dangerouslySetInnerHTML is acceptable
 * here. This component MUST be handed only sanitizer output for the svg case; it
 * never sanitizes raw model output itself, and the markdown sanitizer is never
 * involved with SVG.
 *
 * Accessibility: images carry real alt text (the caption); the SVG container is
 * given role="img" + aria-label; the video iframe has a title; every visual has a
 * visible caption. The "not helpful" control is a real button with an aria-label.
 */

type Props = {
  visual: ResolvedVisual;
  /**
   * Server action that records the not-helpful signal for this visual id. When
   * omitted (e.g. read-only review), the feedback control is hidden.
   */
  onNotHelpful?: (visualId: string) => void | Promise<void>;
};

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="caption"
      component="figcaption"
      sx={{ color: "text.secondary", display: "block" }}
    >
      {children}
    </Typography>
  );
}

function NotHelpful({
  visualId,
  onNotHelpful,
}: {
  visualId: string;
  onNotHelpful?: (visualId: string) => void | Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  if (!onNotHelpful) return null;
  if (done) {
    return (
      <Typography variant="caption" sx={{ color: "text.secondary" }} aria-live="polite">
        Thanks — we will use that.
      </Typography>
    );
  }
  return (
    <Button
      type="button"
      size="small"
      variant="text"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await onNotHelpful(visualId);
          setDone(true);
        })
      }
      aria-label="Mark this visual as not helpful"
      sx={{ color: "text.secondary", textTransform: "none", minWidth: 0, px: 0.5 }}
    >
      Not helpful
    </Button>
  );
}

export default function VisualMedia({ visual, onNotHelpful }: Props) {
  // The gate could not resolve a safe/usable visual: render nothing (the lesson
  // text stands alone). No broken affordance, no arbitrary fallback image.
  if (visual.medium === "none") return null;

  return (
    <Paper
      component="figure"
      variant="outlined"
      sx={{ m: 0, p: 2, borderRadius: 2, bgcolor: "background.paper" }}
    >
      <Stack spacing={1}>
        {visual.medium === "svg" && (
          <Box
            role="img"
            aria-label={visual.caption}
            sx={{
              "& svg": { maxWidth: "100%", height: "auto", display: "block", mx: "auto" },
            }}
            // SAFE: this string is the OUTPUT of the dedicated server-side SVG
            // sanitizer (default-deny allowlist; scripts/handlers/foreignObject
            // already stripped). It never touches the markdown sanitizer.
            dangerouslySetInnerHTML={{ __html: visual.svg }}
          />
        )}

        {visual.medium === "image" && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <Box
              component="img"
              src={visual.url}
              alt={visual.caption}
              loading="lazy"
              sx={{ maxWidth: "100%", height: "auto", borderRadius: 1, display: "block" }}
            />
            <Caption>
              {visual.caption}
              {" — "}
              {visual.attribution.title ? `"${visual.attribution.title}" ` : ""}
              {visual.attribution.creator ? `by ${visual.attribution.creator}, ` : ""}
              {visual.attribution.licenseUrl ? (
                <Link href={visual.attribution.licenseUrl} target="_blank" rel="noopener noreferrer">
                  {visual.attribution.licenseName}
                </Link>
              ) : (
                visual.attribution.licenseName
              )}
              {visual.attribution.sourcePage ? (
                <>
                  {" via "}
                  <Link href={visual.attribution.sourcePage} target="_blank" rel="noopener noreferrer">
                    {visual.attribution.source}
                  </Link>
                </>
              ) : (
                ` via ${visual.attribution.source}`
              )}
            </Caption>
          </>
        )}

        {visual.medium === "video" && (
          <>
            <Box
              sx={{
                position: "relative",
                width: "100%",
                pt: "56.25%", // 16:9
                borderRadius: 1,
                overflow: "hidden",
                bgcolor: "grey.100",
              }}
            >
              <Box
                component="iframe"
                src={visual.embedUrl}
                title={visual.caption}
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                sx={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  border: 0,
                }}
              />
            </Box>
            <Caption>
              {visual.caption} — reference video from {visual.provider} (an
              unevaluated suggestion).
            </Caption>
          </>
        )}

        {visual.medium === "svg" && <Caption>{visual.caption}</Caption>}

        <Box>
          <NotHelpful visualId={visual.id} onNotHelpful={onNotHelpful} />
        </Box>
      </Stack>
    </Paper>
  );
}
