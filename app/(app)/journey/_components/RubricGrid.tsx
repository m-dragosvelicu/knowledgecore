import Grid from "@mui/material/Grid2";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
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

function levelColor(level: number): "default" | "warning" | "success" | "info" | "error" {
  if (level <= 1) return "error";
  if (level === 2) return "warning";
  if (level === 3) return "info";
  return "success";
}

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
        const color = levelColor(level);
        return (
          <Grid key={dim.key} size={{ xs: 12, sm: 6 }}>
            <Tooltip title={dim.description} placement="top" arrow>
              <Card variant="outlined" sx={{ height: "100%" }}>
                <CardContent>
                  <Stack spacing={1}>
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                      <Typography variant="subtitle1" fontWeight={600}>
                        {dim.label}
                      </Typography>
                      <Typography
                        variant="h5"
                        color={`${color}.main`}
                        fontWeight={700}
                      >
                        {level}
                        <Typography component="span" variant="body2" color="text.secondary">
                          /4
                        </Typography>
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {LEVEL_LABEL[level]}
                    </Typography>
                    {evidenceQuote && (
                      <Box
                        sx={{
                          mt: 1,
                          p: 1.5,
                          borderLeft: 4,
                          borderColor: `${color}.main`,
                          bgcolor: "action.hover",
                          borderRadius: 1,
                        }}
                      >
                        <Typography
                          variant="overline"
                          color="text.secondary"
                          sx={{ display: "block", lineHeight: 1.4 }}
                        >
                          From your answer
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{ fontStyle: "italic", fontWeight: 500 }}
                        >
                          &ldquo;{evidenceQuote}&rdquo;
                        </Typography>
                      </Box>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            </Tooltip>
          </Grid>
        );
      })}
    </Grid>
  );
}
