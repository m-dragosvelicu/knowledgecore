import Grid from "@mui/material/Grid2";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import type { EvidenceQuote, RubricScores } from "@/lib/services/types";

const DIMENSIONS: Array<{
  key: keyof RubricScores;
  label: string;
  description: string;
}> = [
  {
    key: "recall",
    label: "Recall",
    description: "Can the learner reproduce key terms and facts accurately?",
  },
  {
    key: "application",
    label: "Application",
    description: "Can the learner execute the procedure correctly on the task?",
  },
  {
    key: "conceptual",
    label: "Conceptual",
    description: "Does the learner explain the concept in their own words and connect it to other ideas?",
  },
  {
    key: "transfer",
    label: "Transfer",
    description: "Can the learner apply the idea to new contexts or recognize when it does not apply?",
  },
  {
    key: "communication",
    label: "Communication",
    description: "Is the explanation clear, structured, and pedagogically useful?",
  },
  {
    key: "coverage",
    label: "Coverage match",
    description: "Does the artifact actually address the goalpost objective?",
  },
];

const LEVEL_LABEL = ["Below threshold", "Emerging", "Proficient", "Advanced", "Mastery"];

/**
 * The checkpoint rubric, in the one-teal vocabulary (no traffic light). Each
 * dimension is a quiet surface card: the level reads as a Fraunces figure, the
 * label in a calm Hanken eyebrow, and the evidence quote in the reading voice
 * behind a teal edge. Below-threshold dimensions sit on the recessed surface so
 * the gap is felt by tone, not by an alarm hue.
 */
export default function RubricGrid({
  scores,
  evidence,
}: {
  scores: RubricScores;
  evidence: EvidenceQuote[];
}) {
  return (
    <Grid container spacing={2}>
      {DIMENSIONS.map((dim) => {
        const level = scores[dim.key];
        const evidenceQuote = evidence.find((e) => e.dimension === dim.key)?.quote;
        const below = level <= 1;
        return (
          <Grid key={dim.key} size={{ xs: 12, sm: 6 }}>
            <Tooltip title={dim.description} placement="top" arrow>
              <Box
                sx={{
                  height: "100%",
                  bgcolor: below ? "var(--surface-2)" : "background.paper",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--r-md)",
                  p: "18px 20px",
                }}
              >
                <Stack spacing={1}>
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="baseline"
                  >
                    <Box
                      sx={{
                        fontSize: 12,
                        fontWeight: 600,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                        color: "var(--ink-2)",
                      }}
                    >
                      {dim.label}
                    </Box>
                    <Box sx={{ display: "flex", alignItems: "baseline", gap: "2px" }}>
                      <Box
                        sx={{
                          fontFamily: "var(--font-display)",
                          fontVariationSettings: "var(--soft-ui)",
                          fontWeight: 500,
                          fontSize: 26,
                          lineHeight: 1,
                          color: below ? "var(--ink-3)" : "var(--teal-deep)",
                        }}
                      >
                        {level}
                      </Box>
                      <Box sx={{ fontSize: 13, color: "var(--ink-3)" }}>/4</Box>
                    </Box>
                  </Stack>
                  <Box className="kc-meta" sx={{ textTransform: "none", letterSpacing: 0 }}>
                    {LEVEL_LABEL[level]}
                  </Box>
                  {evidenceQuote && (
                    <Box
                      sx={{
                        mt: 0.5,
                        pl: "12px",
                        borderLeft: "3px solid var(--teal-soft)",
                      }}
                    >
                      <Box
                        sx={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          letterSpacing: ".14em",
                          textTransform: "uppercase",
                          color: "var(--ink-3)",
                          mb: "4px",
                        }}
                      >
                        From your answer
                      </Box>
                      <Box
                        sx={{
                          fontFamily: "var(--font-read)",
                          fontSize: 14,
                          lineHeight: 1.55,
                          fontStyle: "italic",
                          color: "var(--ink)",
                        }}
                      >
                        &ldquo;{evidenceQuote}&rdquo;
                      </Box>
                    </Box>
                  )}
                </Stack>
              </Box>
            </Tooltip>
          </Grid>
        );
      })}
    </Grid>
  );
}
