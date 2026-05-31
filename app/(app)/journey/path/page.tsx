import { redirect } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Box from "@mui/material/Box";
import { Eyebrow, HeadlineUnderline } from "@/components/ui";
import { getCurrentSession } from "@/lib/auth";
import { getOrCreateActiveIntent, prisma } from "@/lib/journey/state";
import { generatePathAction } from "@/app/(app)/journey/_actions";
import type {
  CanDoStatement,
  Competency,
  PathAdjustment,
  RubricScores,
} from "@/lib/services/types";
import CompetencyBars from "@/app/(app)/journey/_components/CompetencyBars";
import PathTrail, { type TrailNode } from "@/components/journey/PathTrail";
import PathConfirmationGate from "@/components/journey/PathConfirmationGate";
import { GoalpostStatus } from "@prisma/client";

export default async function PathPage() {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/signin");
  const intent = await getOrCreateActiveIntent(session.user.id);
  if (!intent) redirect("/journey/intent");

  const subject = await prisma.subject.findUnique({ where: { intentId: intent.id } });
  const assessment = await prisma.knowledgeAssessment.findUnique({
    where: { intentId: intent.id },
  });
  const outcome = await prisma.expectedOutcome.findUnique({
    where: { intentId: intent.id },
  });
  if (!subject || !assessment) redirect("/journey/probe");

  const canDoStatements =
    (outcome?.canDoStatements as unknown as CanDoStatement[]) ?? [];

  // Pull the latest checkpoint evaluation per goalpost too, so a cleared
  // goalpost can carry a roughened score ellipse on the hand-drawn trail.
  const pathInclude = {
    goalposts: {
      orderBy: { order: "asc" },
      include: {
        steps: { orderBy: { order: "asc" } },
        evaluations: { orderBy: { attempt: "desc" }, take: 1 },
      },
    },
    revisions: { orderBy: { createdAt: "asc" } },
  } as const;

  let path = await prisma.learningPath.findUnique({
    where: { intentId: intent.id },
    include: pathInclude,
  });

  if (!path) {
    await generatePathAction();
    path = await prisma.learningPath.findUnique({
      where: { intentId: intent.id },
      include: pathInclude,
    });
  }

  if (!path) {
    return (
      <Typography variant="body1" color="error">
        Failed to generate a path. Please retry.
      </Typography>
    );
  }

  const accepted = path.acceptedAt != null;

  const totalMinutes = path.goalposts.reduce(
    (sum, gp) => sum + gp.estimatedMinutes,
    0,
  );
  const competencies = assessment!.competencies as unknown as Competency[];

  // Titles of goalposts inserted by any adjust_plan revision -> "added for you".
  const addedTitles = new Set<string>();
  for (const rev of path.revisions) {
    const changes = rev.changes as unknown as PathAdjustment | null;
    for (const gp of changes?.insertedGoalposts ?? []) {
      addedTitles.add(gp.title);
    }
  }

  // The "current" goalpost is the lowest-order non-terminal one. Before
  // acceptance nothing is in_progress yet, so we treat the first goalpost as
  // the next step; everything after it is locked.
  const firstActiveIndex = path.goalposts.findIndex(
    (gp) =>
      gp.status === GoalpostStatus.in_progress ||
      gp.status === GoalpostStatus.pending,
  );

  const nodes: TrailNode[] = path.goalposts.map((gp, i) => {
    let state: TrailNode["state"];
    if (gp.status === GoalpostStatus.complete || gp.status === GoalpostStatus.skipped) {
      state = "completed";
    } else if (i === firstActiveIndex) {
      state = accepted ? "current" : "locked";
    } else {
      state = "locked";
    }
    const stepTypes = Array.from(new Set(gp.steps.map((s) => s.type)));

    // A cleared goalpost's score: the mean of its six rubric dimensions (0..4)
    // from the latest checkpoint evaluation. Absent when the goalpost was
    // skipped or never evaluated -- the trail then shows just the cleared node.
    let score: number | undefined;
    if (state === "completed" && gp.evaluations.length > 0) {
      const s = gp.evaluations[0].scores as unknown as RubricScores;
      const dims: number[] = [
        s.recall,
        s.application,
        s.conceptual,
        s.transfer,
        s.communication,
        s.coverage,
      ];
      const mean = dims.reduce((a, b) => a + b, 0) / dims.length;
      score = Math.round(mean * 10) / 10;
    }

    return {
      id: gp.id,
      order: gp.order,
      title: gp.title,
      objective: gp.objective,
      estimatedMinutes: gp.estimatedMinutes,
      state,
      added: addedTitles.has(gp.title),
      stepTypes: stepTypes as TrailNode["stepTypes"],
      score,
    };
  });

  return (
    <Stack spacing={4}>
      <Stack spacing={1.5}>
        <Eyebrow>Your trail</Eyebrow>
        <HeadlineUnderline>
          <Typography variant="h3" component="h1">
            {subject!.canonicalName}
          </Typography>
        </HeadlineUnderline>
        <Typography variant="body2" color="text.secondary">
          {path.goalposts.length} goalposts &middot; ~{totalMinutes} min to the
          finish
        </Typography>
      </Stack>

      <PathTrail nodes={nodes} />

      {!accepted && (
        <>
          {/* The end "you'll be able to..." achievement -- part of the
              structure-only overview (Call A) the learner confirms before
              committing to the path. */}
          {canDoStatements.length > 0 && (
            <Box
              sx={{
                bgcolor: "var(--surface-2)",
                border: "1px solid var(--line)",
                borderRadius: "var(--r-lg)",
                p: { xs: "24px 22px", md: "32px 36px" },
              }}
            >
              <Stack spacing={2}>
                <Eyebrow>Where this trail ends</Eyebrow>
                <Typography
                  variant="h5"
                  component="h2"
                  sx={{ maxWidth: "52ch" }}
                >
                  By the end, you&rsquo;ll be able to
                </Typography>
                <Stack
                  spacing={1.5}
                  component="ul"
                  sx={{ pl: 0, listStyle: "none", m: 0 }}
                >
                  {canDoStatements.map((cd, i) => (
                    <Stack
                      key={i}
                      component="li"
                      direction="row"
                      spacing={1.5}
                      alignItems="flex-start"
                    >
                      <Box
                        aria-hidden
                        component="svg"
                        viewBox="0 0 24 24"
                        width={18}
                        height={18}
                        sx={{
                          mt: 0.4,
                          flexShrink: 0,
                          fill: "none",
                          stroke: "var(--teal)",
                          strokeWidth: 2.5,
                        }}
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </Box>
                      <Box
                        sx={{
                          fontFamily: "var(--font-read)",
                          fontSize: "16.5px",
                          lineHeight: 1.6,
                          color: "var(--ink)",
                        }}
                      >
                        {cd.text}
                      </Box>
                    </Stack>
                  ))}
                </Stack>
              </Stack>
            </Box>
          )}

          <Stack spacing={2}>
            <Eyebrow>Where you&rsquo;re starting from</Eyebrow>
            <CompetencyBars items={competencies} />
          </Stack>

          {/* L1 Slice 2: the always-present Path Confirmation gate + opt-in
              clarifying dialogue. "Looks good, start" -> acceptPathAction ->
              goalpost 1 (lazy Call B). "Not quite right" -> reused dialogue
              engine -> existing Path Adjuster -> re-present here. */}
          <PathConfirmationGate revisionCount={path.revisionCount} />

          <Accordion
            variant="outlined"
            disableGutters
            sx={{
              bgcolor: "var(--surface-2)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-md)",
              "&:before": { display: "none" },
              "& .MuiAccordionSummary-root": { px: "20px" },
              "& .MuiAccordionDetails-root": { px: "20px", pb: "20px" },
            }}
          >
            <AccordionSummary
              expandIcon={
                <Box
                  aria-hidden
                  component="svg"
                  viewBox="0 0 16 16"
                  width={16}
                  height={16}
                  sx={{ fill: "none", stroke: "var(--ink-3)", strokeWidth: 1.8 }}
                >
                  <polyline
                    points="4 6 8 10 12 6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Box>
              }
            >
              <Box
                sx={{
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "var(--ink-2)",
                }}
              >
                Why this trail?
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <Typography
                variant="body2"
                sx={{
                  fontFamily: "var(--font-read)",
                  lineHeight: 1.65,
                  color: "var(--ink-2)",
                  maxWidth: "62ch",
                }}
              >
                We used your stated outcomes and the competency map from your
                knowledge probe to choose goalposts that target the gaps and
                build toward what you said you want to be able to do. Each
                goalpost ends in a build, so your learning is shown by evidence
                rather than self-report.
              </Typography>
            </AccordionDetails>
          </Accordion>
        </>
      )}
    </Stack>
  );
}
