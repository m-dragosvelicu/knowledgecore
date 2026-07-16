import type { ReactNode } from "react";
import Link from "next/link";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

// Save & leave sits on the SAME row as the step's primary action (never
// stacked): calm secondary link on the left, primary action (children) on
// the right, with a 1px divider above the row. Journey auto-resumes via
// getOrCreateActiveIntent, so leaving is lossless.

/** The quiet door-glyph "Save & leave" link itself (calm secondary). */
export function SaveAndLeaveLink() {
  return (
    <Tooltip
      title="Your progress is saved automatically. You can pick up exactly where you left off."
      placement="top"
      arrow
    >
      <Box
        component={Link}
        href="/"
        aria-label="Save and leave"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          px: 0.5,
          py: 0.25,
          borderRadius: 1,
          color: "var(--ink-3)",
          textDecoration: "none",
          transition: "color .15s ease",
          "&:hover": { color: "text.secondary" },
        }}
      >
        {/* Inline door/exit glyph keeps us offline-safe with no icon dep. */}
        <Box
          component="svg"
          viewBox="0 0 24 24"
          width={16}
          height={16}
          sx={{ fill: "none", stroke: "currentColor", strokeWidth: 2 }}
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </Box>
        <Typography variant="caption" sx={{ fontWeight: 500 }}>
          Save &amp; leave
        </Typography>
      </Box>
    </Tooltip>
  );
}

/** Wraps a step's primary action with the Save & leave row. Use once per step. */
export default function SaveAndLeaveRow({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        mt: "28px",
        pt: "18px",
        borderTop: "1px solid var(--line)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 2,
        flexWrap: "wrap",
      }}
    >
      <SaveAndLeaveLink />
      {children}
    </Box>
  );
}
