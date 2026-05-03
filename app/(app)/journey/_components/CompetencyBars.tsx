import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import LinearProgress from "@mui/material/LinearProgress";
import Box from "@mui/material/Box";
import type { Competency } from "@/lib/services/types";

const LEVEL_LABEL = ["Below threshold", "Emerging", "Proficient", "Advanced", "Mastery"];

export default function CompetencyBars({ items }: { items: Competency[] }) {
  if (items.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No competency data yet.
      </Typography>
    );
  }
  return (
    <Stack spacing={2}>
      {items.map((c) => {
        const pct = (c.estimatedLevel / 4) * 100;
        return (
          <Box key={c.competency}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography variant="body2" fontWeight={500}>
                {c.competency}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {LEVEL_LABEL[c.estimatedLevel]} ({c.estimatedLevel}/4) — confidence{" "}
                {(c.confidence * 100).toFixed(0)}%
              </Typography>
            </Stack>
            <LinearProgress variant="determinate" value={pct} />
          </Box>
        );
      })}
    </Stack>
  );
}
