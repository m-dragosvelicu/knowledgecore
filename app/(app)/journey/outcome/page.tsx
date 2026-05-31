import { redirect } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getCurrentSession } from "@/lib/auth";
import { getOrCreateActiveIntent, prisma } from "@/lib/journey/state";
import OutcomeClient from "./OutcomeClient";

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

      <OutcomeClient defaultMotivation={goal?.motivation ?? null} />
    </Stack>
  );
}
