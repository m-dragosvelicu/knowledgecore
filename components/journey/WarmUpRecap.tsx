import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import SubmitButton from "@/components/journey/SubmitButton";
import { Eyebrow, HeadlineUnderline } from "@/components/ui";

// L0 §9.5 multi-session continuity: the "welcome back" warm-up recap shown when
// a learner resumes a paused journey, BEFORE dropping them back into the
// goalpost. It re-grounds them in where they left off (goalpost title +
// objective + the last evaluation rationale if any). When the inactivity gap
// was long (> 21 days), it ALSO offers an OPT-IN quick refresher per the B.6
// ratified decision: offered, never automatic. Both paths flip the journey
// back to in_progress server-side; the refresher additionally re-opens the
// information phase. No gamification, no emojis.
//
// Slice 4 restyle: warm surface cards, eyebrow meta, the title with its
// self-drawing underline, a solid continue and a skip-tier refresher. The
// refresher card drops the info-blue accent for the one-teal vocabulary.

type Props = {
  // Continue / refresher are server actions defined inline in the resume page.
  continueAction: (formData: FormData) => void | Promise<void>;
  refresherAction: (formData: FormData) => void | Promise<void>;
  // The journey id, carried as a hidden form field so the continue/refresher
  // writes target the journey the learner resumed (addressable resume).
  intentId: string;
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
  intentId,
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
      <Stack spacing={1.5}>
        <Eyebrow>Welcome back</Eyebrow>
        <HeadlineUnderline>
          <Typography variant="h3" component="h1">
            {subjectName ? `Picking up ${subjectName}` : "Picking up where you left off"}
          </Typography>
        </HeadlineUnderline>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ maxWidth: "60ch", lineHeight: 1.6 }}
        >
          It has been {describeGap(idleDays)} since you were last here.
          Here&rsquo;s a quick reminder of where you stopped before you continue.
        </Typography>
      </Stack>

      <Box
        sx={{
          bgcolor: "background.paper",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-lg)",
          boxShadow: "var(--shadow-sm)",
          p: { xs: "28px 24px", md: "40px 48px" },
        }}
      >
        <Stack spacing={3}>
          <Eyebrow>Goalpost {order} &middot; where you left off</Eyebrow>

          <Typography variant="h4" component="h2">
            {title}
          </Typography>

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

          {lastRationale && (
            <>
              <Divider />
              <Box>
                <Eyebrow sx={{ mb: 1 }}>Where you got to last time</Eyebrow>
                <Typography
                  variant="body1"
                  sx={{
                    fontFamily: "var(--font-read)",
                    lineHeight: 1.65,
                    color: "var(--ink-2)",
                    maxWidth: "60ch",
                  }}
                >
                  {lastRationale}
                </Typography>
              </Box>
            </>
          )}
        </Stack>
      </Box>

      {offerRefresher && (
        <Box
          sx={{
            bgcolor: "var(--surface-2)",
            border: "1px solid var(--line)",
            borderLeft: "3px solid var(--teal)",
            borderRadius: "var(--r-lg)",
            p: { xs: "24px 22px", md: "32px 40px" },
          }}
        >
          <Stack spacing={2}>
            <Eyebrow>Optional</Eyebrow>
            <Typography
              variant="body1"
              sx={{ lineHeight: 1.6, maxWidth: "60ch" }}
            >
              Since it has been a while, you can re-read this goalpost&rsquo;s
              material before you carry on. This is entirely up to you. Skip it if
              you already feel ready.
            </Typography>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              alignItems={{ sm: "center" }}
              sx={{ pt: 0.5 }}
            >
              <form action={continueAction}>
                <input type="hidden" name="j" value={intentId} />
                <SubmitButton
                  variant="contained"
                  color="kcInk"
                  size="large"
                  pendingLabel="Taking you back…"
                >
                  Continue where I left off
                </SubmitButton>
              </form>
              <form action={refresherAction}>
                <input type="hidden" name="j" value={intentId} />
                <SubmitButton
                  variant="text"
                  size="large"
                  pendingLabel="Opening the refresher…"
                >
                  Re-read this goalpost first
                </SubmitButton>
              </form>
            </Stack>
          </Stack>
        </Box>
      )}

      {!offerRefresher && (
        <form action={continueAction}>
          <input type="hidden" name="j" value={intentId} />
          <SubmitButton
            variant="contained"
            color="kcInk"
            size="large"
            pendingLabel="Taking you back…"
          >
            Continue
          </SubmitButton>
        </form>
      )}
    </Stack>
  );
}
