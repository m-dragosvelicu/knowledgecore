import { redirect } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import RadioGroup from "@mui/material/RadioGroup";
import Radio from "@mui/material/Radio";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormControl from "@mui/material/FormControl";
import FormLabel from "@mui/material/FormLabel";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import { getCurrentSession } from "@/lib/auth";
import { getOrCreateActiveIntent, prisma } from "@/lib/journey/state";
import { submitOutcomeAction } from "@/app/(app)/journey/_actions";

const MOTIVATIONS: Array<{ value: string; label: string }> = [
  { value: "curiosity", label: "Curiosity" },
  { value: "fun", label: "Fun" },
  { value: "school", label: "School" },
  { value: "work", label: "Work" },
  { value: "other", label: "Other" },
];

export default async function OutcomePage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/signin");
  const intent = await getOrCreateActiveIntent(session.user.id);
  if (!intent) redirect("/journey/intent");
  const subject = await prisma.subject.findUnique({ where: { intentId: intent.id } });
  if (!subject) redirect("/journey/intent");
  const goal = await prisma.learningGoal.findUnique({ where: { intentId: intent.id } });

  return (
    <Stack spacing={4}>
      <Stack spacing={1}>
        <Typography variant="overline" color="text.secondary">
          Your subject
        </Typography>
        <Typography variant="h3" component="h1">
          {subject.canonicalName}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {subject.scopeNote}
        </Typography>
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <form action={submitOutcomeAction}>
            <Stack spacing={3}>
              <Typography variant="h5" component="h2">
                Tell us about your goal
              </Typography>

              <FormControl required>
                <FormLabel>Why do you want to learn this?</FormLabel>
                <RadioGroup
                  row
                  name="motivation"
                  defaultValue={goal?.motivation ?? ""}
                >
                  {MOTIVATIONS.map((m) => (
                    <FormControlLabel
                      key={m.value}
                      value={m.value}
                      control={<Radio required />}
                      label={m.label}
                    />
                  ))}
                </RadioGroup>
              </FormControl>

              <TextField
                name="elaboration"
                label="Tell me more about why"
                multiline
                minRows={3}
                required
                fullWidth
                defaultValue={goal?.elaboration ?? ""}
              />

              <TextField
                name="timeHorizon"
                label="Time horizon (optional)"
                placeholder="e.g., 3 weeks before the exam"
                fullWidth
                defaultValue={goal?.timeHorizon ?? ""}
              />

              <Button type="submit" variant="contained" size="large" sx={{ alignSelf: "flex-start" }}>
                Continue to knowledge probe
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Stack>
  );
}
