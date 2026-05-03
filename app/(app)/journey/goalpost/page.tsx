import { redirect } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Box from "@mui/material/Box";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import { auth } from "@/auth";
import {
  getCurrentGoalpost,
  getOrCreateActiveIntent,
  prisma,
} from "@/lib/journey/state";
import {
  adjustPlanAction,
  advanceGoalpostAction,
  completeInformationStepAction,
  repeatGoalpostAction,
  submitExperienceStepAction,
} from "@/app/(app)/journey/_actions";
import RubricGrid from "@/app/(app)/journey/_components/RubricGrid";
import { Decision, StepType } from "@prisma/client";
import type { EvidenceQuote, RubricScores } from "@/lib/services/types";

function renderMarkdownLite(text: string): React.ReactElement {
  const paragraphs = text.split(/\n\n+/);
  return (
    <Stack spacing={2}>
      {paragraphs.map((p, i) => (
        <Typography key={i} variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
          {p}
        </Typography>
      ))}
    </Stack>
  );
}

const DECISION_COLORS: Record<Decision, "success" | "warning" | "info"> = {
  advance: "success",
  repeat: "warning",
  adjust_plan: "info",
};

const DECISION_LABELS: Record<Decision, string> = {
  advance: "Advance",
  repeat: "Try again",
  adjust_plan: "Adjust the plan",
};

export default async function GoalpostPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const intent = await getOrCreateActiveIntent(session.user.id);
  if (!intent) redirect("/journey/intent");
  if (intent.status === "complete") redirect("/journey/complete");

  const goalpost = await getCurrentGoalpost(intent.id);
  if (!goalpost) redirect("/journey/path");

  const informationStep = goalpost!.steps.find((s) => s.type === StepType.information);
  const experienceStep = goalpost!.steps.find((s) => s.type !== StepType.information);

  // Phase decision:
  //  - if information step exists and is incomplete → information sub-view
  //  - else if experience step has no userArtifact → experience sub-view
  //  - else → evaluation sub-view
  let phase: "information" | "experience" | "evaluation" = "evaluation";
  if (informationStep && !informationStep.completedAt) {
    phase = "information";
  } else if (experienceStep && !experienceStep.userArtifact) {
    phase = "experience";
  }

  const header = (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Chip label={`Goalpost ${goalpost!.order}`} size="small" />
        <Typography variant="caption" color="text.secondary">
          ~{goalpost!.estimatedMinutes} min &middot; phase: {phase}
        </Typography>
      </Stack>
      <Typography variant="h3" component="h1">
        {goalpost!.title}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {goalpost!.objective}
      </Typography>
    </Stack>
  );

  // -----------------------------------------------------------------------
  // Information sub-view
  // -----------------------------------------------------------------------
  if (phase === "information" && informationStep) {
    const content = (informationStep.payload as { content?: string } | null)?.content ?? "";
    return (
      <Stack spacing={4}>
        {header}
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={3}>
              <Typography variant="overline" color="text.secondary">
                Information
              </Typography>
              {renderMarkdownLite(content)}
              <form action={completeInformationStepAction}>
                <input type="hidden" name="stepId" value={informationStep.id} />
                <Button type="submit" variant="contained" size="large">
                  I have read this — continue to the experience
                </Button>
              </form>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    );
  }

  // -----------------------------------------------------------------------
  // Experience sub-view
  // -----------------------------------------------------------------------
  if (phase === "experience" && experienceStep) {
    const prompt = (experienceStep.payload as { prompt?: string } | null)?.prompt ?? "";
    return (
      <Stack spacing={4}>
        {header}
        <Card variant="outlined">
          <CardContent>
            <form action={submitExperienceStepAction}>
              <input type="hidden" name="stepId" value={experienceStep.id} />
              <Stack spacing={3}>
                <Typography variant="overline" color="text.secondary">
                  Experience
                </Typography>
                <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
                  {prompt}
                </Typography>
                <TextField
                  name="userArtifact"
                  multiline
                  minRows={8}
                  fullWidth
                  required
                  placeholder="Type your answer here. Show your work."
                />
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  sx={{ alignSelf: "flex-start" }}
                >
                  Submit my answer
                </Button>
              </Stack>
            </form>
          </CardContent>
        </Card>
      </Stack>
    );
  }

  // -----------------------------------------------------------------------
  // Evaluation sub-view
  // -----------------------------------------------------------------------
  const evaluation = await prisma.checkpointEvaluation.findFirst({
    where: { goalpostId: goalpost!.id },
    orderBy: { createdAt: "desc" },
  });

  if (!evaluation) {
    return (
      <Stack spacing={4}>
        {header}
        <Alert severity="warning">
          No evaluation found yet. Please retry the experience step.
        </Alert>
      </Stack>
    );
  }

  const scores = evaluation.scores as unknown as RubricScores;
  const evidence = evaluation.evidence as unknown as EvidenceQuote[];
  const decision = evaluation.decision;
  const color = DECISION_COLORS[decision];

  return (
    <Stack spacing={4}>
      {header}

      <Card
        variant="outlined"
        sx={{
          borderColor: `${color}.main`,
          borderWidth: 2,
        }}
      >
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Chip
                label={DECISION_LABELS[decision]}
                color={color}
                size="medium"
              />
              <Typography variant="overline" color="text.secondary">
                Attempt {evaluation.attempt}
              </Typography>
            </Stack>
            <Typography variant="body1">{evaluation.rationale}</Typography>
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
          Rubric scores
        </Typography>
        <RubricGrid scores={scores} evidence={evidence} />
      </Box>

      {decision === Decision.advance && (
        <form action={advanceGoalpostAction}>
          <input type="hidden" name="goalpostId" value={goalpost!.id} />
          <Button type="submit" variant="contained" size="large">
            Continue to next goalpost
          </Button>
        </form>
      )}

      {decision === Decision.repeat && (
        <form action={repeatGoalpostAction}>
          <input type="hidden" name="goalpostId" value={goalpost!.id} />
          <Button type="submit" variant="contained" color="warning" size="large">
            Try again
          </Button>
        </form>
      )}

      {decision === Decision.adjust_plan && (
        <Stack spacing={2}>
          <Alert severity="info">
            Path adjustment is not yet implemented in mock mode. Selecting
            &ldquo;View revised path&rdquo; will end the journey for now.
          </Alert>
          <form action={adjustPlanAction}>
            <input type="hidden" name="goalpostId" value={goalpost!.id} />
            <Button type="submit" variant="contained" color="info" size="large">
              View revised path
            </Button>
          </form>
        </Stack>
      )}
    </Stack>
  );
}
