import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import { submitIntentAction } from "@/app/(app)/journey/_actions";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getOrCreateActiveIntent } from "@/lib/journey/state";

export default async function IntentPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const intent = await getOrCreateActiveIntent(session.user.id);

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
          <TextField
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
          <Button type="submit" variant="contained" size="large" sx={{ alignSelf: "flex-start" }}>
            Continue
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}
