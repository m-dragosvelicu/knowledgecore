import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Alert from "@mui/material/Alert";
import SubmitButton from "@/components/journey/SubmitButton";
import MicTextField from "@/components/journey/MicTextField";
import {
  confirmIntentAction,
  submitIntentAction,
} from "@/app/(app)/journey/_actions";
import { getCurrentSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getOrCreateActiveIntent, prisma } from "@/lib/journey/state";

type SearchParams = Promise<{ confirm?: string; note?: string }>;

export default async function IntentPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = (await searchParams) ?? {};
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/signin");
  const intent = await getOrCreateActiveIntent(session.user.id);

  // -----------------------------------------------------------------------
  // Confirm / refine sub-view (L0.md §3 Stage 2 ambiguity surfacing). Shown
  // only when submitIntentAction parsed an ambiguous intent and bounced back
  // here with ?confirm=1. The parser's best interpretation was already saved as
  // the Subject; the learner either accepts it or refines their wording. We do
  // NOT silently narrow on their behalf.
  // -----------------------------------------------------------------------
  const subject = intent
    ? await prisma.subject.findUnique({ where: { intentId: intent.id } })
    : null;

  if (params.confirm === "1" && subject) {
    const clarification =
      params.note ??
      "That could mean a few different things — does the interpretation below match what you had in mind?";
    return (
      <Stack spacing={3}>
        <Typography variant="h3" component="h1">
          Let&rsquo;s make sure we&rsquo;ve got this right
        </Typography>
        <Alert severity="info" sx={{ "& .MuiAlert-message": { width: "100%" } }}>
          {clarification}
        </Alert>

        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1}>
              <Typography variant="overline" color="text.secondary">
                Our reading of your intent
              </Typography>
              <Typography variant="h5" component="p">
                {subject.canonicalName}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {subject.scopeNote}
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems={{ sm: "flex-start" }}
        >
          {/* Accept the interpretation as-is and proceed. */}
          <form action={confirmIntentAction}>
            <SubmitButton
              variant="contained"
              size="large"
              pendingLabel="Setting your direction…"
            >
              Yes, that&rsquo;s right
            </SubmitButton>
          </form>
        </Stack>

        <Typography variant="body2" color="text.secondary">
          Not quite? Refine it below and we&rsquo;ll read it again.
        </Typography>
        <form action={submitIntentAction}>
          <Stack spacing={2}>
            <MicTextField
              name="rawText"
              label="Refine your learning intent"
              placeholder="e.g., classical mechanics for a first-year physics course"
              multiline
              minRows={3}
              required
              fullWidth
              defaultValue={intent?.rawText ?? ""}
            />
            <SubmitButton
              variant="outlined"
              size="large"
              pendingLabel="Reading your intent…"
              sx={{ alignSelf: "flex-start" }}
            >
              Re-read my intent
            </SubmitButton>
          </Stack>
        </form>
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <Typography variant="h3" component="h1">
        What do you want to learn?
      </Typography>
      <Typography variant="body1" color="text.secondary">
        Describe the topic in your own words. We will use this to set your
        direction for the rest of the journey.
      </Typography>

      <form action={submitIntentAction}>
        <Stack spacing={2}>
          <MicTextField
            name="rawText"
            label="Your learning intent"
            placeholder="e.g., linear algebra basics for machine learning"
            multiline
            minRows={3}
            required
            fullWidth
            defaultValue={intent?.rawText ?? ""}
          />
          <Typography variant="caption" color="text.secondary">
            Tip: try &ldquo;linear algebra basics for machine learning&rdquo; to
            see the rich pre-baked example.
          </Typography>
          <SubmitButton
            variant="contained"
            size="large"
            pendingLabel="Reading your intent…"
            sx={{ alignSelf: "flex-start" }}
          >
            Continue
          </SubmitButton>
        </Stack>
      </form>
    </Stack>
  );
}
