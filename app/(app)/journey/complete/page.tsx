import { redirect } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import SubmitButton from "@/components/journey/SubmitButton";
import { getCurrentSession, isAnonymousSession } from "@/lib/auth";
import { GATE_REDIRECT } from "@/lib/auth-guards";
import { prisma } from "@/lib/journey/state";
import { startNewJourneyAction } from "@/app/(app)/journey/_actions";
import { Eyebrow, HeadlineUnderline, ScoreBadge } from "@/components/ui";
import type {
  CanDoStatement,
  EvidenceQuote,
  RubricScores,
} from "@/lib/services/types";
import { GoalpostStatus } from "@prisma/client";

export default async function CompletePage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/signin");
  if (isAnonymousSession(session)) redirect(GATE_REDIRECT);

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
      {/* The completion as an achievement moment: the roughened score badge
          carries the "done" the way the kit's +1 moment does, beside the
          Fraunces headline with its self-drawing underline. */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={{ xs: 2.5, sm: 4 }}
        alignItems={{ sm: "center" }}
      >
        <Box sx={{ flexShrink: 0 }}>
          <ScoreBadge big="done" sub="trail" />
        </Box>
        <Stack spacing={1.5}>
          <Eyebrow>Journey complete</Eyebrow>
          <HeadlineUnderline>
            <Typography variant="h3" component="h1">
              You finished {subject}
            </Typography>
          </HeadlineUnderline>
          <Typography variant="body2" color="text.secondary">
            {completedGoalposts.length} of {goalposts.length} goalposts completed
            {revisions.length > 0
              ? ` · trail reshaped ${revisions.length} ${
                  revisions.length === 1 ? "time" : "times"
                } along the way`
              : ""}
            .
          </Typography>
        </Stack>
      </Stack>

      {/* What you set out to do, and the evidence you earned for it. */}
      {canDoStatements.length > 0 && (
        <Box>
          <Eyebrow sx={{ mb: 2 }}>What you set out to be able to do</Eyebrow>
          <Stack spacing={1.5}>
            {canDoStatements.map((stmt, i) => (
              <Box
                key={i}
                sx={{
                  bgcolor: "var(--surface-2)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--r-md)",
                  p: "16px 20px",
                }}
              >
                <Stack direction="row" spacing={2} alignItems="flex-start">
                  <Chip
                    label={stmt.bloomLevel}
                    size="small"
                    sx={{ textTransform: "capitalize", flexShrink: 0, mt: "2px" }}
                  />
                  <Box
                    sx={{
                      fontFamily: "var(--font-display)",
                      fontVariationSettings: "var(--soft-ui)",
                      fontWeight: 500,
                      fontSize: 18,
                      lineHeight: 1.35,
                      color: "var(--ink)",
                    }}
                  >
                    {stmt.text}
                  </Box>
                </Stack>
              </Box>
            ))}
          </Stack>
        </Box>
      )}

      {earned.length > 0 && (
        <Box>
          <Eyebrow sx={{ mb: 1 }}>Evidence you produced</Eyebrow>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: "60ch" }}>
            These are moments from your own answers where you showed understanding.
            Not self-report, but what you actually wrote.
          </Typography>
          <Stack spacing={2}>
            {earned.map((e, i) => (
              <Box
                key={i}
                sx={{
                  borderLeft: "3px solid var(--teal)",
                  pl: "16px",
                  py: "2px",
                }}
              >
                <Box
                  className="kc-meta"
                  sx={{ mb: "6px" }}
                >
                  {e.goalpostTitle} &middot; {e.dimension}
                </Box>
                <Box
                  sx={{
                    fontFamily: "var(--font-read)",
                    fontSize: "17px",
                    lineHeight: 1.6,
                    fontStyle: "italic",
                    color: "var(--ink)",
                    maxWidth: "62ch",
                  }}
                >
                  &ldquo;{e.quote}&rdquo;
                </Box>
              </Box>
            ))}
          </Stack>
        </Box>
      )}

      <Box>
        <Eyebrow sx={{ mb: 2 }}>Your goalposts</Eyebrow>
        <Stack spacing={1.25}>
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
          <Eyebrow sx={{ mb: 1.5 }}>How your trail adapted</Eyebrow>
          <Stack spacing={1}>
            {revisions.map((r) => {
              const rationale =
                (r.changes as { rationale?: string } | null)?.rationale ??
                "The trail was reshaped to better fit your progress.";
              return (
                <Typography
                  key={r.id}
                  variant="body2"
                  color="text.secondary"
                  sx={{ lineHeight: 1.6, maxWidth: "62ch" }}
                >
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
          color="kcInk"
          size="large"
          pendingLabel="Starting a new journey…"
        >
          Start a new journey
        </SubmitButton>
      </form>
    </Stack>
  );
}
