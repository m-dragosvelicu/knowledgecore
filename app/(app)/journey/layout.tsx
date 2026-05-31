import type { ReactNode } from "react";
import Link from "next/link";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";

// B.6 Q8 save-and-leave: a low-contrast exit affordance in the journey chrome.
// The journey auto-resumes via getOrCreateActiveIntent, so leaving is lossless
// and we simply link home. Kept intentionally quiet so it never competes with
// the primary action on each step.
export default function JourneyLayout({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ position: "relative" }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          mb: 1,
        }}
      >
        <Tooltip
          title="Your progress is saved automatically. You can pick up exactly where you left off."
          placement="left"
          arrow
        >
          <IconButton
            component={Link}
            href="/"
            size="small"
            color="inherit"
            aria-label="Save and leave"
            sx={{ color: "text.secondary", borderRadius: 1, px: 1 }}
          >
            {/* Inline door/exit glyph keeps us offline-safe with no icon dep. */}
            <Box
              component="svg"
              viewBox="0 0 24 24"
              width={18}
              height={18}
              sx={{ fill: "none", stroke: "currentColor", strokeWidth: 2 }}
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </Box>
            <Typography variant="caption" sx={{ ml: 0.5 }}>
              Save &amp; leave
            </Typography>
          </IconButton>
        </Tooltip>
      </Box>
      {children}
    </Box>
  );
}
