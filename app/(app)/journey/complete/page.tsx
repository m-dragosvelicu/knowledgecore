import { redirect } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import SubmitButton from "@/components/journey/SubmitButton";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/journey/state";
import { startNewJourneyAction } from "@/app/(app)/journey/_actions";
import type {
  CanDoStatement,
  EvidenceQuote,
  RubricScores,
} from "@/lib/services/types";
import { GoalpostStatus } from "@prisma/client";

export default async function CompletePage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/signin");

  // Find the most recently completed journey, with everything we need to map
  // can-do statements to the evidence the learner actually produced.
  const intent = await prisma.learningIntent.findFirst({
    where: { userId: session.user.id, status: "complete" },
    orderBy: { updatedAt: "desc" },
    include: {
      subject: true,
      outcome: true,
      path: {
        include: {
          revisions: { orderBy: { createdAt: "asc" } },
          goalposts: {
            orderBy: { order: "asc" },
            include: { evaluations: { orderBy: { createdAt: "desc" } } },
          },
        },
      },
    },
  });

  const subject = intent?.subject?.canonicalName ?? "your subject";
  const goalposts = intent?.path?.goalposts ?? [];
  const revisions = intent?.path?.revisions ?? [];
  const canDoStatements =
    (intent?.outcome?.canDoStatements as unknown as CanDoStatement[]) ??
    [];

  const completedGoalposts = goalposts.filter(
    (g) => g.status === GoalpostStatus.complete,
  );

  // Collect the strongest evidence quotes earned across the path: the latest
  // evaluation per goalpost, every dimension where the learner scored well
  // enough to count as demonstrated (level >= 3).
  type EarnedEvidence = {
    goalpostTitle: string;
    dimension: string;
    quote: string;
    level: number;
  };
  const earned: EarnedEvidence[] = [];
  for (const gp of goalposts) {
    const latest = gp.evaluations[0];
    if (!latest) continue;
    const scores = latest.scores as unknown as RubricScores;
    const evidence = latest.evidence as unknown as EvidenceQuote[];
    for (const ev of evidence) {
      const level = scores[ev.dimension];
      if (level >= 3 && ev.quote?.trim()) {
        earned.push({
          goalpostTitle: gp.title,
          dimension: ev.dimension,
          quote: ev.quote,
          level,
        });
      }
    }
  }

  return (
    <Stack spacing={4}>
      <Stack spacing={1}>
        <Typography variant="overline" color="text.secondary">
          Journey complete
        </Typography>
        <Typography variant="h3" component="h1">
          You completed your journey on {subject}.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {completedGoalposts.length} of {goalposts.length} goalposts completed
          {revisions.length > 0
            ? ` · path revised ${revisions.length} ${
                revisions.length === 1 ? "time" : "times"
              } along the way`
            : ""}
          .
        </Typography>
      </Stack>

      {/* What you set out to do, and the evidence you earned for it. */}
      {canDoStatements.length > 0 && (
        <Box>
          <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
            What you set out to be able to do
          </Typography>
          <Stack spacing={2}>
            {canDoStatements.map((stmt, i) => (
              <Card key={i} variant="outlined">
                <CardContent>
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} alignItems="baseline">
                      <Chip label={stmt.bloomLevel} size="small" />
                      <Typography variant="subtitle1" fontWeight={600}>
                        {stmt.text}
                      </Typography>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        </Box>
      )}

      {earned.length > 0 && (
        <Box>
          <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
            Evidence you produced
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            These are moments from your own answers where you demonstrated
            understanding — not self-report, but what you actually wrote.
          </Typography>
          <Stack spacing={2}>
            {earned.map((e, i) => (
              <Box
                key={i}
                sx={{
                  borderLeft: 4,
                  borderColor: "success.main",
                  bgcolor: "action.hover",
                  borderRadius: 1,
                  p: 2,
                }}
              >
                <Typography variant="overline" color="text.secondary">
                  {e.goalpostTitle} · {e.dimension}
                </Typography>
                <Typography variant="body1" sx={{ fontStyle: "italic", fontWeight: 500 }}>
                  &ldquo;{e.quote}&rdquo;
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      )}

      <Box>
        <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
          Goalposts
        </Typography>
        <Stack spacing={1}>
          {goalposts.map((gp) => {
            const isSkipped = gp.status === GoalpostStatus.skipped;
            return (
              <Stack
                key={gp.id}
                direction="row"
                spacing={2}
                alignItems="baseline"
                sx={{ opacity: isSkipped ? 0.6 : 1 }}
              >
                <Chip
                  label={isSkipped ? "Skipped" : "Done"}
                  color={isSkipped ? "default" : "success"}
                  size="small"
                  variant={isSkipped ? "outlined" : "filled"}
                />
                <Typography variant="body1">
                  {gp.order}. {gp.title}
                </Typography>
              </Stack>
            );
          })}
        </Stack>
      </Box>

      {revisions.length > 0 && (
        <Box>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
            How your path adapted
          </Typography>
          <Stack spacing={1}>
            {revisions.map((r) => {
              const rationale =
                (r.changes as { rationale?: string } | null)?.rationale ??
                "The path was revised to better fit your progress.";
              return (
                <Typography key={r.id} variant="body2" color="text.secondary">
                  {rationale}
                </Typography>
              );
            })}
          </Stack>
        </Box>
      )}

      <form action={startNewJourneyAction}>
        <SubmitButton
          variant="contained"
          size="large"
          pendingLabel="Starting a new journey…"
        >
          Start a new journey
        </SubmitButton>
      </form>
    </Stack>
  );
}
