import Link from "next/link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import type { ReactNode } from "react";

// B.6 §5.1: completed goalposts are tappable for read-only review of their
// information and the learner's own artifact (retrieval-practice friendly).
// This is purely a recap surface -- no actions advance the journey from here.

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
};

export default function ReviewView({
  order,
  title,
  objective,
  information,
  prompt,
  userArtifact,
  decisionLabel,
  decisionColor,
  rationale,
}: Props) {
  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip label={`Goalpost ${order}`} size="small" />
          <Chip label="Review" size="small" variant="outlined" color="success" />
        </Stack>
        <Typography variant="h3" component="h1">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {objective}
        </Typography>
      </Stack>

      {information && (
        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 3, md: 4 } }}>
            <Typography variant="overline" color="text.secondary">
              What you read
            </Typography>
            <Box
              sx={{
                // Reading type (decided): Hanken — NOT a serif — at a calm
                // reading size, generous measure and line-height.
                fontFamily: "var(--font-read)",
                fontSize: "16px",
                lineHeight: 1.7,
                maxWidth: "62ch",
                color: "text.secondary",
                mt: 1,
                "& p": { my: 1.25 },
              }}
            >
              {information}
            </Box>
          </CardContent>
        </Card>
      )}

      {(prompt || userArtifact) && (
        <Card variant="outlined" sx={{ borderLeft: 6, borderLeftColor: "primary.main" }}>
          <CardContent sx={{ p: { xs: 3, md: 4 } }}>
            <Stack spacing={2}>
              {prompt && (
                <Box>
                  <Typography variant="overline" color="text.secondary">
                    The task
                  </Typography>
                  <Box sx={{ mt: 0.5 }}>{prompt}</Box>
                </Box>
              )}
              {prompt && userArtifact && <Divider />}
              {userArtifact && (
                <Box>
                  <Typography variant="overline" color="text.secondary">
                    Your answer
                  </Typography>
                  <Typography
                    variant="body1"
                    sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}
                  >
                    {userArtifact}
                  </Typography>
                </Box>
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

      {decisionLabel && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1.5}>
              <Chip
                label={decisionLabel}
                color={decisionColor === "default" ? undefined : decisionColor}
                size="small"
                sx={{ alignSelf: "flex-start" }}
              />
              {rationale && (
                <Typography variant="body2" color="text.secondary">
                  {rationale}
                </Typography>
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

      <Button
        component={Link}
        href="/journey/path"
        variant="text"
        sx={{ alignSelf: "flex-start" }}
      >
        Back to your path
      </Button>
    </Stack>
  );
}
