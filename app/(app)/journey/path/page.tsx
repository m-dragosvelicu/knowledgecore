import { redirect } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Box from "@mui/material/Box";
import { getCurrentSession } from "@/lib/auth";
import { getOrCreateActiveIntent, prisma } from "@/lib/journey/state";
import { generatePathAction } from "@/app/(app)/journey/_actions";
import type {
  CanDoStatement,
  Competency,
  PathAdjustment,
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

  let path = await prisma.learningPath.findUnique({
    where: { intentId: intent.id },
    include: {
      goalposts: {
        orderBy: { order: "asc" },
        include: { steps: { orderBy: { order: "asc" } } },
      },
      revisions: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!path) {
    await generatePathAction();
    path = await prisma.learningPath.findUnique({
      where: { intentId: intent.id },
      include: {
        goalposts: {
          orderBy: { order: "asc" },
          include: { steps: { orderBy: { order: "asc" } } },
        },
        revisions: { orderBy: { createdAt: "asc" } },
      },
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
    return {
      id: gp.id,
      order: gp.order,
      title: gp.title,
      objective: gp.objective,
      estimatedMinutes: gp.estimatedMinutes,
      state,
      added: addedTitles.has(gp.title),
      stepTypes: stepTypes as TrailNode["stepTypes"],
    };
  });

  return (
    <Stack spacing={4}>
      <Stack spacing={1}>
        <Typography variant="overline" color="text.secondary">
          Your learning path
        </Typography>
        <Typography variant="h3" component="h1">
          {subject!.canonicalName}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {path.goalposts.length} goalposts &middot; ~{totalMinutes} minutes
          estimated
        </Typography>
      </Stack>

      <PathTrail nodes={nodes} />

      {!accepted && (
        <>
          {/* The end "you'll be able to..." achievement -- part of the
              structure-only overview (Call A) the learner confirms before
              committing to the path. */}
          {canDoStatements.length > 0 && (
            <Stack spacing={1.5}>
              <Typography variant="subtitle2">
                By the end, you&rsquo;ll be able to:
              </Typography>
              <Stack
                spacing={1.25}
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
                        stroke: "currentColor",
                        strokeWidth: 2.5,
                        color: "success.main",
                      }}
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </Box>
                    <Typography variant="body1">{cd.text}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Stack>
          )}

          <Stack spacing={2}>
            <Typography variant="h5" component="h2">
              Where you are starting from
            </Typography>
            <CompetencyBars items={competencies} />
          </Stack>

          {/* L1 Slice 2: the always-present Path Confirmation gate + opt-in
              clarifying dialogue. "Looks good, start" -> acceptPathAction ->
              goalpost 1 (lazy Call B). "Not quite right" -> reused dialogue
              engine -> existing Path Adjuster -> re-present here. */}
          <PathConfirmationGate revisionCount={path.revisionCount} />

          <Accordion variant="outlined">
            <AccordionSummary>
              <Typography variant="body1">Why this path?</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="body2" color="text.secondary">
                The Path Outliner used your stated outcomes and the competency
                map from your knowledge probe to choose goalposts that target
                the gaps and build toward the can-do statements you confirmed.
                Each goalpost includes at least one experience step so we can
                verify learning with evidence rather than self-report.
              </Typography>
            </AccordionDetails>
          </Accordion>
        </>
      )}
    </Stack>
  );
}
