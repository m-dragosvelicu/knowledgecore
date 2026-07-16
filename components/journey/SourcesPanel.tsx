"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import type { JourneySource } from "@/app/api/journey/[journeyId]/sources/route";
import { Eyebrow } from "@/components/ui";

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ok"; sources: JourneySource[] }
  | { status: "error" };

type Props = {
  journeyId: string;
};

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M14 4L4 14M4 4l10 10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SourceRow({ source }: { source: JourneySource }) {
  const href =
    source.canonicalUrl ??
    (source.doi ? `https://doi.org/${source.doi}` : null);

  const kindLabel = source.kind === "academic" ? "Academic" : "Web";

  return (
    <Box
      component="li"
      sx={{
        listStyle: "none",
        py: "14px",
        "&:not(:last-child)": {
          borderBottom: "1px solid var(--line)",
        },
      }}
    >
      <Stack spacing={0.5}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Chip
            label={kindLabel}
            size="small"
            variant="outlined"
            sx={{
              flexShrink: 0,
              height: "20px",
              fontSize: "11px",
              fontFamily: "var(--font-body)",
              letterSpacing: ".03em",
              mt: "2px",
              color: "var(--ink-3)",
              borderColor: "var(--line)",
            }}
          />
          {href ? (
            <Typography
              component="a"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                fontFamily: "var(--font-body)",
                fontSize: "15px",
                fontWeight: 500,
                color: "var(--teal-deep)",
                textDecoration: "none",
                lineHeight: 1.4,
                "&:hover": { textDecoration: "underline", textUnderlineOffset: "3px" },
                "&:focus-visible": {
                  outline: "none",
                  boxShadow: "var(--focus-ring)",
                  borderRadius: "4px",
                },
              }}
            >
              {source.title}
            </Typography>
          ) : (
            <Typography
              sx={{
                fontFamily: "var(--font-body)",
                fontSize: "15px",
                fontWeight: 500,
                color: "var(--ink)",
                lineHeight: 1.4,
              }}
            >
              {source.title}
            </Typography>
          )}
        </Stack>
        <Typography
          variant="body2"
          sx={{
            color: "var(--ink-3)",
            fontFamily: "var(--font-body)",
            fontSize: "13px",
            pl: href ? "68px" : 0,
          }}
        >
          {source.attribution}
          {href && (
            <Typography
              component="span"
              sx={{
                display: "inline-block",
                ml: 1,
                fontSize: "11px",
                color: "var(--ink-3)",
                verticalAlign: "middle",
              }}
              aria-label="(opens in new tab)"
            >
              [link]
            </Typography>
          )}
        </Typography>
      </Stack>
    </Box>
  );
}

/**
 * Sources affordance (E01.S07). Fetch deferred to first open; empty response
 * hides the chip; fetch errors degrade gracefully without crashing the page.
 */
export default function SourcesPanel({ journeyId }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FetchState>({ status: "idle" });
  const fetchedRef = useRef(false);
  const chipRef = useRef<HTMLDivElement>(null);

  const fetchSources = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/journey/${journeyId}/sources`);
      if (!res.ok) {
        setState({ status: "error" });
        return;
      }
      const data = await res.json() as { sources: JourneySource[] };
      if (data.sources.length === 0) {
        setState({ status: "empty" });
      } else {
        setState({ status: "ok", sources: data.sources });
      }
    } catch {
      setState({ status: "error" });
    }
  }, [journeyId]);

  function handleOpen() {
    setOpen(true);
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetchSources();
    }
  }

  function handleClose() {
    setOpen(false);
  }

  // Return focus to the trigger chip when the dialog closes.
  useEffect(() => {
    if (!open && fetchedRef.current) {
      chipRef.current?.focus();
    }
  }, [open]);

  // Hide the chip once we know this journey has no sources.
  if (state.status === "empty") return null;

  return (
    <>
      <Chip
        ref={chipRef}
        label="Sources"
        variant="outlined"
        size="small"
        clickable
        onClick={handleOpen}
        aria-haspopup="dialog"
        aria-label="View sources for this lesson"
        sx={{
          fontFamily: "var(--font-body)",
          fontSize: "13px",
          letterSpacing: ".02em",
          color: "var(--teal-deep)",
          borderColor: "var(--teal-soft)",
          bgcolor: "transparent",
          "&:hover": {
            bgcolor: "var(--teal-soft)",
            borderColor: "var(--teal)",
          },
          "&:focus-visible": {
            outline: "none",
            boxShadow: "var(--focus-ring)",
          },
        }}
      />

      <Dialog
        open={open}
        onClose={handleClose}
        aria-labelledby="sources-dialog-title"
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: "background.paper",
            borderRadius: "var(--r-lg)",
            border: "1px solid var(--line)",
            boxShadow: "var(--shadow)",
          },
        }}
      >
        <DialogTitle
          id="sources-dialog-title"
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            pb: 1,
            pt: 3,
            px: 3,
          }}
        >
          <Stack spacing={0.5}>
            <Eyebrow component="div">This lesson</Eyebrow>
            <Typography
              sx={{
                fontFamily: "var(--font-display)",
                fontVariationSettings: "var(--soft-ui)",
                fontWeight: 500,
                fontSize: "22px",
                letterSpacing: "-.01em",
                color: "var(--ink)",
              }}
            >
              Sources
            </Typography>
          </Stack>
          <IconButton
            aria-label="Close sources"
            onClick={handleClose}
            size="small"
            sx={{
              color: "var(--ink-3)",
              "&:hover": { color: "var(--ink)", bgcolor: "var(--surface-2)" },
              "&:focus-visible": { boxShadow: "var(--focus-ring)" },
            }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <Divider sx={{ mx: 3 }} />

        <DialogContent sx={{ px: 3, py: 2 }}>
          {state.status === "loading" && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ py: 2, fontFamily: "var(--font-body)" }}
            >
              Loading sources...
            </Typography>
          )}

          {state.status === "error" && (
            <Box
              sx={{
                bgcolor: "var(--surface-2)",
                border: "1px solid var(--line)",
                borderRadius: "var(--r-md)",
                p: "14px 18px",
                my: 1,
              }}
            >
              <Typography
                variant="body2"
                sx={{ color: "var(--ink-2)", fontFamily: "var(--font-body)" }}
              >
                Sources could not be loaded. The rest of your lesson is unaffected.
              </Typography>
            </Box>
          )}

          {state.status === "ok" && (
            <Box
              component="ul"
              aria-label="Lesson sources"
              sx={{ m: 0, p: 0 }}
            >
              {state.sources.map((source) => (
                <SourceRow key={source.id} source={source} />
              ))}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 3, pt: 1 }}>
          <Button
            onClick={handleClose}
            variant="text"
            size="medium"
            sx={{
              color: "var(--ink-3)",
              fontFamily: "var(--font-body)",
              "&:hover": { color: "var(--ink)", bgcolor: "var(--surface-2)" },
              "&:focus-visible": { boxShadow: "var(--focus-ring)" },
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
