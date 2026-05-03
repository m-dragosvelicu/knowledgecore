import { redirect } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { auth } from "@/auth";
import { getOrCreateActiveIntent, prisma } from "@/lib/journey/state";
import { getServices } from "@/lib/services";
import type { CanDoStatement } from "@/lib/services/types";
import ProbeClient from "./ProbeClient";

export default async function ProbePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const intent = await getOrCreateActiveIntent(session.user.id);
  if (!intent) redirect("/journey/intent");

  const subject = await prisma.subject.findUnique({ where: { intentId: intent.id } });
  const outcome = await prisma.expectedOutcome.findUnique({ where: { intentId: intent.id } });
  if (!subject || !outcome) redirect("/journey/outcome");

  const services = getServices();
  const canDo = outcome!.canDoStatements as unknown as CanDoStatement[];
  const questions = await services.knowledgeProbe.questions(
    { canonicalName: subject!.canonicalName, scopeNote: subject!.scopeNote },
    canDo,
  );

  return (
    <Stack spacing={3}>
      <Typography variant="h3" component="h1">
        Knowledge probe
      </Typography>
      <Typography variant="body1" color="text.secondary">
        A few quick questions to calibrate your starting point. Wrong answers
        help us, do not worry — there is no grade here.
      </Typography>
      <ProbeClient questions={questions} />
    </Stack>
  );
}
