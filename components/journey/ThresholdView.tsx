import Link from "next/link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import SolidButton from "@/components/ui/SolidButton";
import { Eyebrow, HeadlineUnderline } from "@/components/ui";

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
    <Box
      className="kc-fade"
      sx={{
        bgcolor: "background.paper",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-sm)",
        p: { xs: "32px 26px", md: "48px 52px" },
      }}
    >
      <Stack spacing={3}>
        <Eyebrow>
          Goalpost {order} of {totalGoalposts}
        </Eyebrow>

        <HeadlineUnderline>
          <Typography variant="h3" component="h1">
            {title}
          </Typography>
        </HeadlineUnderline>

        <Box>
          <Eyebrow sx={{ mb: 1 }}>What you&rsquo;ll be able to do</Eyebrow>
          <Typography
            variant="h6"
            component="p"
            sx={{ fontWeight: 400, lineHeight: 1.5, maxWidth: "58ch" }}
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
          <Chip label={`~${estimatedMinutes} min`} variant="outlined" size="small" />
          <Chip label={`Ends with ${experienceLabel}`} size="small" />
        </Stack>

        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ maxWidth: "60ch", lineHeight: 1.6 }}
        >
          Take your time. You&rsquo;ll read a short piece first, then put it to
          work. Your progress is saved automatically, so you can stop at any point
          and pick up exactly where you left off.
        </Typography>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems={{ sm: "center" }}
          sx={{ pt: 1 }}
        >
          <SolidButton component={Link} href={beginHref} tone="ink" size="large">
            Begin
          </SolidButton>
          <Button
            component={Link}
            href="/"
            variant="text"
            size="large"
            sx={{ color: "var(--ink-3)" }}
          >
            Save for later
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
