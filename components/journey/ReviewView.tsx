import Link from "next/link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import { Eyebrow, HeadlineUnderline } from "@/components/ui";
import type { ReactNode } from "react";

// B.6 §5.1: completed goalposts are tappable for read-only review of their
// information and the learner's own artifact (retrieval-practice friendly).
// This is purely a recap surface -- no actions advance the journey from here.
//
// Slice 4 restyle: the reading recap on warm paper in the calm reading voice,
// the build recap on the recessed Experience surface, and the checkpoint note in
// the one-teal vocabulary. Back to your trail is a workbench-tier action.

type Props = {
  order: number;
  title: string;
  objective: string;
  // Server-rendered markdown.
  information: ReactNode | null;
  prompt: ReactNode | null;
  userArtifact: string | null;
  decisionLabel: string | null;
  decisionColor: "success" | "warning" | "info" | "default";
  rationale: string | null;
  // The resolved journey id (from ?j), so "Back to your trail" returns to the
  // same journey rather than the most-recent one.
  intentId?: string | null;
};

// The calm reading measure + size, matching InformationView (the kit checkpoint
// starting values).
const readingSx = {
  fontFamily: "var(--font-read)",
  maxWidth: "62ch",
  color: "var(--ink-2)",
  "& p": { fontSize: "16.5px", lineHeight: 1.7, my: "1em" },
  "& blockquote": {
    m: "1.4em 0",
    pl: "1.1em",
    borderLeft: "3px solid var(--teal)",
    color: "var(--ink)",
    fontStyle: "italic",
  },
} as const;

export default function ReviewView({
  order,
  title,
  objective,
  information,
  prompt,
  userArtifact,
  decisionLabel,
  rationale,
  intentId,
}: Props) {
  return (
    <Stack spacing={3}>
      <Stack spacing={1.5}>
        <Eyebrow>Goalpost {order} &middot; review</Eyebrow>
        <HeadlineUnderline>
          <Typography variant="h3" component="h1">
            {title}
          </Typography>
        </HeadlineUnderline>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: "62ch" }}>
          {objective}
        </Typography>
      </Stack>

      {information && (
        <Box
          sx={{
            bgcolor: "background.paper",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-lg)",
            boxShadow: "var(--shadow-sm)",
            p: { xs: "24px 22px", md: "36px 44px" },
          }}
        >
          <Stack spacing={2}>
            <Eyebrow>What you read</Eyebrow>
            <Box sx={readingSx}>{information}</Box>
          </Stack>
        </Box>
      )}

      {(prompt || userArtifact) && (
        <Box
          sx={{
            bgcolor: "var(--surface-experience)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-lg)",
            p: { xs: "24px 22px", md: "32px 40px" },
          }}
        >
          <Stack spacing={2.5}>
            {prompt && (
              <Box>
                <Eyebrow sx={{ mb: 1 }}>The build</Eyebrow>
                <Box sx={readingSx}>{prompt}</Box>
              </Box>
            )}
            {prompt && userArtifact && <Divider />}
            {userArtifact && (
              <Box>
                <Eyebrow sx={{ mb: 1 }}>Your answer</Eyebrow>
                <Box
                  sx={{
                    fontFamily: "var(--font-read)",
                    fontSize: "16px",
                    lineHeight: 1.65,
                    color: "var(--ink)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {userArtifact}
                </Box>
              </Box>
            )}
          </Stack>
        </Box>
      )}

      {decisionLabel && (
        <Box
          sx={{
            bgcolor: "background.paper",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-md)",
            p: "18px 22px",
          }}
        >
          <Stack spacing={1}>
            <Eyebrow>Checkpoint &middot; {decisionLabel.toLowerCase()}</Eyebrow>
            {rationale && (
              <Typography
                variant="body2"
                sx={{
                  fontFamily: "var(--font-read)",
                  lineHeight: 1.65,
                  color: "var(--ink-2)",
                  maxWidth: "60ch",
                }}
              >
                {rationale}
              </Typography>
            )}
          </Stack>
        </Box>
      )}

      <Button
        component={Link}
        href={intentId ? `/journey/path?j=${intentId}` : "/journey/path"}
        variant="text"
        sx={{ alignSelf: "flex-start", px: 0 }}
      >
        Back to your trail
      </Button>
    </Stack>
  );
}
