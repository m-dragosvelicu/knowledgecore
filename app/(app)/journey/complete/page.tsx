import { redirect } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/journey/state";
import { startNewJourneyAction } from "@/app/(app)/journey/_actions";

export default async function CompletePage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/signin");

  // Find the most recently completed (or in-progress that just transitioned) journey.
  const intent = await prisma.learningIntent.findFirst({
    where: { userId: session.user.id, status: "complete" },
    orderBy: { updatedAt: "desc" },
    include: {
      subject: true,
      path: {
        include: {
          goalposts: {
            include: { evaluations: { orderBy: { createdAt: "desc" } } },
          },
        },
      },
    },
  });

  const subject = intent?.subject?.canonicalName ?? "your subject";
  const goalposts = intent?.path?.goalposts ?? [];
  const allEvals = goalposts.flatMap((g) => g.evaluations);

  type RubricScoreShape = {
    recall: number;
    application: number;
    conceptual: number;
    transfer: number;
    communication: number;
    coverage: number;
  };
  const dimSum = { recall: 0, application: 0, conceptual: 0, transfer: 0, communication: 0, coverage: 0 };
  let count = 0;
  for (const e of allEvals) {
    const s = e.scores as unknown as RubricScoreShape;
    dimSum.recall += s.recall;
    dimSum.application += s.application;
    dimSum.conceptual += s.conceptual;
    dimSum.transfer += s.transfer;
    dimSum.communication += s.communication;
    dimSum.coverage += s.coverage;
    count++;
  }
  const avg =
    count > 0
      ? (
          (dimSum.recall +
            dimSum.application +
            dimSum.conceptual +
            dimSum.transfer +
            dimSum.communication +
            dimSum.coverage) /
          (count * 6)
        ).toFixed(2)
      : "n/a";

  return (
    <Stack spacing={4}>
      <Stack spacing={1}>
        <Typography variant="overline" color="text.secondary">
          Journey complete
        </Typography>
        <Typography variant="h3" component="h1">
          You completed your journey on {subject}.
        </Typography>
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={1}>
            <Typography variant="h5" component="h2">
              Summary
            </Typography>
            <Typography variant="body1">
              {goalposts.length} goalposts completed.
            </Typography>
            <Typography variant="body1">
              Average rubric score across {count} evaluations: {avg} / 4.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Time spent: tracked in a future iteration.
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <form action={startNewJourneyAction}>
        <Button type="submit" variant="contained" size="large">
          Start a new journey
        </Button>
      </form>
    </Stack>
  );
}
