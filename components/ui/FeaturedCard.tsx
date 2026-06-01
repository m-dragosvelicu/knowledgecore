// KnowledgeCore — Featured card (Slice 1).
//
// The big "resume" card: a 1.25fr / .75fr two-column grid on a --surface fill
// with a hand-drawn corner squiggle, the main pad on the left, and a recessed
// --surface-2 side panel divided from the body by a hairline. The grid collapses
// to a single column at 820px (side panel moves below). Radius 28 (feature),
// soft directional shadow.
//
// Ported from design-system/preview/comp-featured.html. The standard (non-
// featured) card is just the themed <Card> (MuiCard override), so it needs no
// bespoke component; use MUI <Card> directly for those.
//
// This is structural/presentational only — content (eyebrow, headline, side
// stat) is passed in as props/children, so screens in later slices fill it.

import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import { CornerSquiggle } from "@/components/marks/Marks";

export type FeaturedCardProps = {
  /** Main column content (eyebrow, headline w/ underline, supporting copy). */
  children: ReactNode;
  /** Recessed --surface-2 side panel content (e.g. an ETA stat). */
  side?: ReactNode;
  /** Show the hand-drawn corner squiggle flourish. Default true. */
  squiggle?: boolean;
};

export default function FeaturedCard({
  children,
  side,
  squiggle = true,
}: FeaturedCardProps) {
  return (
    <Box
      component="article"
      sx={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "1.25fr .75fr",
        bgcolor: "background.paper",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow)",
        overflow: "hidden",
        width: "100%",
        // Collapse to one column on narrow viewports; side panel drops below.
        "@media (max-width:820px)": {
          gridTemplateColumns: "1fr",
        },
      }}
    >
      {squiggle && (
        <CornerSquiggle
          style={{
            position: "absolute",
            top: 10,
            right: 14,
            zIndex: 2,
          }}
        />
      )}

      {/* minWidth:0 lets the 1.25fr track honor its share instead of growing to
          its content's min-content width (the CSS Grid fr-track overflow trap),
          which previously skewed the column ratio and misaligned the card. */}
      <Box sx={{ minWidth: 0, p: "24px 26px" }}>{children}</Box>

      {side != null && (
        <Box
          sx={{
            minWidth: 0,
            bgcolor: "var(--surface-2)",
            borderLeft: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "6px",
            p: "24px 26px",
            "@media (max-width:820px)": {
              borderLeft: "none",
              borderTop: "1px solid var(--line)",
            },
          }}
        >
          {side}
        </Box>
      )}
    </Box>
  );
}
