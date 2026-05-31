import Link from "next/link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";

// B.6 §1.1 (Q10): the per-goalpost "threshold" screen. A single deliberate
// moment shown BEFORE the information phase that names what is about to happen:
// goalpost title, the restated objective/can-do, the experience type, an
// advisory time estimate, and two actions -- Begin / Save for later.

type Props = {
  order: number;
  totalGoalposts: number;
  title: string;
  objective: string;
  estimatedMinutes: number;
  // Human label for the experience type this goalpost ends with.
  experienceLabel: string;
  // Where Begin routes (transition into the information phase).
  beginHref: string;
};

export default function ThresholdView({
  order,
  totalGoalposts,
  title,
  objective,
  estimatedMinutes,
  experienceLabel,
  beginHref,
}: Props) {
  return (
    <Stack spacing={3}>
      <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2 }}>
        Goalpost {order} of {totalGoalposts}
      </Typography>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ p: { xs: 3, md: 5 } }}>
          <Stack spacing={3}>
            <Typography variant="h3" component="h1">
              {title}
            </Typography>

            <Box>
              <Typography variant="overline" color="text.secondary">
                What you&rsquo;ll be able to do
              </Typography>
              <Typography
                variant="h6"
                component="p"
                sx={{ fontWeight: 400, lineHeight: 1.5, mt: 0.5 }}
              >
                {objective}
              </Typography>
            </Box>

            <Stack
              direction="row"
              spacing={1.5}
              alignItems="center"
              sx={{ flexWrap: "wrap", rowGap: 1 }}
            >
              <Chip
                label={`approx ${estimatedMinutes} min`}
                variant="outlined"
                size="small"
              />
              <Chip
                label={`Ends with: ${experienceLabel}`}
                color="primary"
                variant="outlined"
                size="small"
              />
            </Stack>

            <Typography variant="body2" color="text.secondary">
              Take your time. You&rsquo;ll read a short piece first, then put it
              to work. Your progress is saved automatically, so you can stop at
              any point and pick up exactly where you left off.
            </Typography>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              sx={{ pt: 1 }}
            >
              <Button
                component={Link}
                href={beginHref}
                variant="contained"
                size="large"
              >
                Begin
              </Button>
              <Button
                component={Link}
                href="/"
                variant="text"
                size="large"
                color="inherit"
                sx={{ color: "text.secondary" }}
              >
                Save for later
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
