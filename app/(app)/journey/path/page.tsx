import { redirect } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Divider from "@mui/material/Divider";
import { auth } from "@/auth";
import { getOrCreateActiveIntent, prisma } from "@/lib/journey/state";
import {
  acceptPathAction,
  generatePathAction,
} from "@/app/(app)/journey/_actions";
import type { Competency } from "@/lib/services/types";
import CompetencyBars from "@/app/(app)/journey/_components/CompetencyBars";
import { StepType } from "@prisma/client";

const STEP_TYPE_LABEL: Record<StepType, string> = {
  information: "Information",
  experience_socratic: "Socratic dialogue",
  experience_applied_problem: "Applied problem",
  experience_mini_project: "Mini-project",
};

export default async function PathPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const intent = await getOrCreateActiveIntent(session.user.id);
  if (!intent) redirect("/journey/intent");

  const subject = await prisma.subject.findUnique({ where: { intentId: intent.id } });
  const assessment = await prisma.knowledgeAssessment.findUnique({
    where: { intentId: intent.id },
  });
  if (!subject || !assessment) redirect("/journey/probe");

  let path = await prisma.learningPath.findUnique({
    where: { intentId: intent.id },
    include: {
      goalposts: {
        orderBy: { order: "asc" },
        include: { steps: { orderBy: { order: "asc" } } },
      },
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

  const totalMinutes = path.goalposts.reduce(
    (sum, gp) => sum + gp.estimatedMinutes,
    0,
  );
  const competencies = assessment!.competencies as unknown as Competency[];

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

      <Stack spacing={2}>
        {path.goalposts.map((gp) => {
          const stepTypes = Array.from(new Set(gp.steps.map((s) => s.type)));
          return (
            <Card key={gp.id} variant="outlined">
              <CardContent>
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                    <Typography variant="h6">
                      {gp.order}. {gp.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      ~{gp.estimatedMinutes} min
                    </Typography>
                  </Stack>
                  <Typography variant="body2">{gp.objective}</Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
                    {stepTypes.map((t) => (
                      <Chip key={t} label={STEP_TYPE_LABEL[t]} size="small" />
                    ))}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          );
        })}
      </Stack>

      <Divider />

      <Stack spacing={2}>
        <Typography variant="h5" component="h2">
          Where you are starting from
        </Typography>
        <CompetencyBars items={competencies} />
      </Stack>

      <form action={acceptPathAction}>
        <Button type="submit" variant="contained" size="large">
          Accept this path
        </Button>
      </form>

      <Accordion variant="outlined">
        <AccordionSummary>
          <Typography variant="body1">Why this path?</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" color="text.secondary">
            The Path Outliner used your stated outcomes and the competency map
            from your knowledge probe to choose goalposts that target the gaps
            and build toward the can-do statements you confirmed. Each goalpost
            includes at least one experience step so we can verify learning
            with evidence rather than self-report. (Detailed explanations are a
            placeholder for now.)
          </Typography>
        </AccordionDetails>
      </Accordion>
    </Stack>
  );
}
