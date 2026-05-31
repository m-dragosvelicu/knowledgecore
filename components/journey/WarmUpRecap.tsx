import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import SubmitButton from "@/components/journey/SubmitButton";

// L0 §9.5 multi-session continuity: the "Welcome back" warm-up recap shown when
// a learner resumes a paused journey, BEFORE dropping them back into the
// goalpost. It re-grounds them in where they left off (goalpost title +
// objective + the last evaluation rationale if any). When the inactivity gap
// was long (> 21 days), it ALSO offers an OPT-IN quick refresher per the B.6
// ratified decision: offered, never automatic. Both paths flip the journey
// back to in_progress server-side; the refresher additionally re-opens the
// information phase. No gamification, no emojis.

type Props = {
  // Continue / refresher are server actions defined inline in the resume page.
  continueAction: (formData: FormData) => void | Promise<void>;
  refresherAction: (formData: FormData) => void | Promise<void>;
  subjectName: string | null;
  order: number;
  title: string;
  objective: string;
  lastRationale: string | null;
  idleDays: number;
  // True when the gap crossed the §9.5 / B.6 opt-in refresher threshold (21d).
  offerRefresher: boolean;
};

function describeGap(idleDays: number): string {
  const whole = Math.floor(idleDays);
  if (whole >= 14) return `about ${Math.round(whole / 7)} weeks`;
  if (whole >= 7) return "over a week";
  if (whole <= 1) return "a little while";
  return `about ${whole} days`;
}

export default function WarmUpRecap({
  continueAction,
  refresherAction,
  subjectName,
  order,
  title,
  objective,
  lastRationale,
  idleDays,
  offerRefresher,
}: Props) {
  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2 }}>
          Welcome back
        </Typography>
        <Typography variant="h3" component="h1">
          {subjectName ? `Picking up ${subjectName}` : "Picking up where you left off"}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          It has been {describeGap(idleDays)} since you were last here. Here&rsquo;s
          a quick reminder of where you stopped before you continue.
        </Typography>
      </Stack>

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ p: { xs: 3, md: 5 } }}>
          <Stack spacing={3}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip label={`Goalpost ${order}`} size="small" />
              <Typography variant="caption" color="text.secondary">
                where you left off
              </Typography>
            </Stack>

            <Typography variant="h4" component="h2">
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

            {lastRationale && (
              <>
                <Divider />
                <Box>
                  <Typography variant="overline" color="text.secondary">
                    Where you got to last time
                  </Typography>
                  <Typography
                    variant="body1"
                    sx={{ mt: 0.5, lineHeight: 1.6 }}
                  >
                    {lastRationale}
                  </Typography>
                </Box>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>

      {offerRefresher && (
        <Card
          variant="outlined"
          sx={{
            borderRadius: 2,
            borderLeft: 6,
            borderLeftColor: "info.main",
            bgcolor: "background.paper",
          }}
        >
          <CardContent sx={{ p: { xs: 3, md: 4 } }}>
            <Stack spacing={2}>
              <Typography variant="overline" color="text.secondary">
                Optional
              </Typography>
              <Typography variant="body1">
                Since it has been a while, you can re-read this goalpost&rsquo;s
                material before you carry on. This is entirely up to you &mdash;
                skip it if you already feel ready.
              </Typography>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                sx={{ pt: 0.5 }}
              >
                <form action={refresherAction}>
                  <SubmitButton
                    variant="outlined"
                    color="info"
                    size="large"
                    pendingLabel="Opening the refresher…"
                  >
                    Re-read this goalpost first
                  </SubmitButton>
                </form>
                <form action={continueAction}>
                  <SubmitButton
                    variant="contained"
                    size="large"
                    pendingLabel="Taking you back…"
                  >
                    Skip &mdash; continue where I left off
                  </SubmitButton>
                </form>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}

      {!offerRefresher && (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ pt: 1 }}
        >
          <form action={continueAction}>
            <SubmitButton
              variant="contained"
              size="large"
              pendingLabel="Taking you back…"
            >
              Continue
            </SubmitButton>
          </form>
        </Stack>
      )}
    </Stack>
  );
}
