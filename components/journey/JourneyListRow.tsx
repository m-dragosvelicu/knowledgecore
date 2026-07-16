"use client";

// KnowledgeCore — a single journey row on the "all journeys" page. Renders the
// SAME design-system journey row as the home dashboard, and adds a QUIET delete
// affordance: a small "..." overflow button that only appears / firms up on row
// hover or focus, never a prominent red button. It opens a calm confirmation
// DIALOG (styled MUI Dialog, design-system surfaces — NOT window.confirm) that
// NAMES the journey before anything is removed. Deleting runs the
// ownership-scoped server action and the list refreshes.
//
// The row itself is a Link; the overflow control sits OUTSIDE that link (a
// sibling, absolutely positioned) so clicking it never navigates.

import { useState, useTransition } from "react";
import Link from "next/link";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Dialog from "@mui/material/Dialog";
import { ScoreBadge } from "@/components/ui";
import SolidButton from "@/components/ui/SolidButton";
import WobbleButton from "@/components/ui/WobbleButton";
import { Eyebrow } from "@/components/ui";
import { deleteJourneyAction } from "@/app/journeys/_actions";

export type JourneyListRowData = {
  id: string;
  title: string;
  meta: string;
  /** Big glyph for the score badge (e.g. "3/5", "Done", "—"). */
  badgeBig: string;
  badgeSub: string;
  /**
   * Whether the badge value is a genuine SCORE (wrap in the roughened ellipse)
   * vs. plain goalpost PROGRESS (render un-circled). The journey lists only ever
   * surface goalpost progress, so this is false there; the ellipse is reserved
   * for real score contexts (trail, complete page).
   */
  scored?: boolean;
  /** Resolved route for the row link (nextWizardRoute on the server). */
  href: string;
};

export default function JourneyListRow({ data }: { data: JourneyListRowData }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function confirmDelete() {
    const fd = new FormData();
    fd.set("intentId", data.id);
    startTransition(async () => {
      await deleteJourneyAction(fd);
      setOpen(false);
    });
  }

  return (
    <Box sx={{ position: "relative", "&:hover .kc-row-del": { opacity: 1 } }}>
      <Box
        component={Link}
        href={data.href}
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "24px",
          py: "22px",
          // Leave room on the right so the overflow control never overlaps text.
          pl: "4px",
          pr: "44px",
          borderBottom: "1px solid var(--line)",
          cursor: "pointer",
          textDecoration: "none",
          color: "inherit",
          transition: "padding-left .2s",
          "&:hover": { pl: "12px" },
          "&:hover .kc-row-title": { color: "var(--teal-deep)" },
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Box
            className="kc-row-title"
            sx={{
              fontFamily: "var(--font-display)",
              fontWeight: 500,
              fontSize: 20,
              letterSpacing: "-.01em",
              fontVariationSettings: '"SOFT" 30',
              color: "var(--ink)",
              transition: "color .2s",
            }}
          >
            {data.title}
          </Box>
          <Box sx={{ mt: "5px", fontSize: 13, color: "var(--ink-3)" }}>{data.meta}</Box>
        </Box>

        <Box sx={{ flex: "none" }}>
          <ScoreBadge big={data.badgeBig} sub={data.badgeSub} ring={data.scored ?? false} />
        </Box>
      </Box>

      <IconButton
        className="kc-row-del"
        aria-label={`More actions for ${data.title}`}
        onClick={() => setOpen(true)}
        size="small"
        sx={{
          position: "absolute",
          top: "50%",
          right: "2px",
          transform: "translateY(-50%)",
          color: "var(--ink-3)",
          opacity: 0,
          transition: "opacity .2s, color .15s, background-color .15s",
          "&:hover": { color: "var(--ink)", backgroundColor: "var(--surface-2)" },
          "&:focus-visible": { opacity: 1 },
        }}
      >
        <Box
          aria-hidden="true"
          sx={{
            display: "grid",
            gap: "3px",
            "& span": {
              display: "block",
              width: "3.5px",
              height: "3.5px",
              borderRadius: "50%",
              bgcolor: "currentColor",
            },
          }}
        >
          <span />
          <span />
          <span />
        </Box>
      </IconButton>

      <Dialog
        open={open}
        onClose={() => !isPending && setOpen(false)}
        aria-labelledby="kc-del-title"
        aria-describedby="kc-del-body"
        slotProps={{
          paper: {
            elevation: 0,
            sx: {
              bgcolor: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-lg)",
              boxShadow: "var(--shadow)",
              backgroundImage: "none",
              maxWidth: 460,
              p: "28px 30px",
            },
          },
        }}
      >
        <Eyebrow sx={{ mb: "10px" }}>Delete journey</Eyebrow>
        <Box
          id="kc-del-title"
          component="h2"
          sx={{
            m: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 400,
            fontSize: 27,
            lineHeight: 1.12,
            letterSpacing: "-.01em",
            fontVariationSettings: '"SOFT" 20',
            color: "var(--ink)",
          }}
        >
          Delete &ldquo;{data.title}&rdquo;?
        </Box>
        <Box
          id="kc-del-body"
          component="p"
          sx={{ mt: "12px", mb: "24px", fontSize: 15, lineHeight: 1.55, color: "var(--ink-2)" }}
        >
          This removes the journey and everything along its trail, including its
          path, goalposts, checkpoints and scores. You cannot undo this.
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px" }}>
          <WobbleButton bare onClick={() => setOpen(false)} disabled={isPending}>
            Keep it
          </WobbleButton>
          <SolidButton tone="ink" arrow={false} onClick={confirmDelete} disabled={isPending}>
            {isPending ? "Deleting…" : "Delete journey"}
          </SolidButton>
        </Box>
      </Dialog>
    </Box>
  );
}
