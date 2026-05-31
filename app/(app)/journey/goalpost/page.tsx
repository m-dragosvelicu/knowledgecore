import { redirect } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Box from "@mui/material/Box";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import { getCurrentSession } from "@/lib/auth";
import {
  getCurrentGoalpost,
  getOrCreateActiveIntent,
  prisma,
} from "@/lib/journey/state";
import {
  adjustPlanAction,
  advanceGoalpostAction,
  completeInformationStepAction,
  overrideDecisionAction,
  repeatGoalpostAction,
  submitExperienceStepAction,
} from "@/app/(app)/journey/_actions";
import RubricGrid from "@/app/(app)/journey/_components/RubricGrid";
import SubmitButton from "@/components/journey/SubmitButton";
import ExperienceForm from "@/components/journey/ExperienceForm";
import InformationView from "@/components/journey/InformationView";
import OverrideControl from "@/components/journey/OverrideControl";
import ThresholdView from "@/components/journey/ThresholdView";
import ReviewView from "@/components/journey/ReviewView";
import Markdown from "@/components/Markdown";
import { Decision, StepType } from "@prisma/client";
import type { EvidenceQuote, RubricScores } from "@/lib/services/types";

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

// Human-readable label for the experience type a goalpost ends with.
const EXPERIENCE_LABELS: Record<StepType, string> = {
  information: "a review",
  experience_socratic: "a Socratic dialogue",
  experience_applied_problem: "an applied problem",
  experience_mini_project: "a mini-project",
};

type SearchParams = Promise<{
  phase?: string;
  begin?: string;
  review?: string;
}>;

export default async function GoalpostPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = (await searchParams) ?? {};
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/signin");
  const intent = await getOrCreateActiveIntent(session.user.id);
  if (!intent) redirect("/journey/intent");

  // §9.5 multi-session continuity: a journey that lazily transitioned to
  // `paused` (>7d idle, see lib/journey/state.ts) gets a warm-up recap BEFORE
  // being dropped back into the goalpost. The review sub-view below is exempt
  // so a paused journey can still be browsed read-only from the path trail.
  if (intent.status === "paused" && !params.review) {
    redirect("/journey/resume");
  }

  // -----------------------------------------------------------------------
  // Read-only review of a completed goalpost (B.6 §5.1, linked from the path
  // trail). Handled before the in_progress redirect so a finished journey can
  // still be reviewed from the dashboard.
  // -----------------------------------------------------------------------
  if (params.review) {
    const reviewed = await prisma.goalpost.findUnique({
      where: { id: params.review },
      include: {
        steps: { orderBy: { order: "asc" } },
        path: { select: { intent: { select: { userId: true } } } },
        evaluations: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    // Ownership guard: only the journey's own learner can review its goalposts.
    if (reviewed && reviewed.path.intent.userId === session.user.id) {
      const infoStep = reviewed.steps.find((s) => s.type === StepType.information);
      const expStep = reviewed.steps.find((s) => s.type !== StepType.information);
      const infoContent =
        (infoStep?.payload as { content?: string } | null)?.content ?? "";
      const promptContent =
        (expStep?.payload as { prompt?: string } | null)?.prompt ?? "";
      const latest = reviewed.evaluations[0];
      return (
        <ReviewView
          order={reviewed.order}
          title={reviewed.title}
          objective={reviewed.objective}
          information={infoContent ? <Markdown>{infoContent}</Markdown> : null}
          prompt={promptContent ? <Markdown>{promptContent}</Markdown> : null}
          userArtifact={expStep?.userArtifact ?? null}
          decisionLabel={latest ? DECISION_LABELS[latest.decision] : null}
          decisionColor={latest ? DECISION_COLORS[latest.decision] : "default"}
          rationale={latest?.rationale ?? null}
        />
      );
    }
    redirect("/journey/path");
  }

  if (intent.status === "complete") redirect("/journey/complete");

  const goalpost = await getCurrentGoalpost(intent.id);
  if (!goalpost) redirect("/journey/path");

  const informationStep = goalpost!.steps.find((s) => s.type === StepType.information);
  const experienceStep = goalpost!.steps.find((s) => s.type !== StepType.information);

  // -----------------------------------------------------------------------
  // Threshold sub-view (B.6 §1.1 / Q10): shown BEFORE the information phase for
  // a goalpost the learner has not opened yet this session. "Fresh" means the
  // information step is not yet completed AND no evaluation exists. The
  // ?phase=information (or ?begin=1) param transitions past the threshold so we
  // never block the existing information -> experience -> evaluation flow.
  // -----------------------------------------------------------------------
  const evaluationCount = await prisma.checkpointEvaluation.count({
    where: { goalpostId: goalpost!.id },
  });
  const isFresh =
    !!informationStep && !informationStep.completedAt && evaluationCount === 0;
  const begun = params.phase === "information" || params.begin === "1";
  if (isFresh && !begun) {
    const totalGoalposts = await prisma.goalpost.count({
      where: { pathId: goalpost!.pathId },
    });
    const expType = experienceStep?.type ?? StepType.information;
    return (
      <ThresholdView
        order={goalpost!.order}
        totalGoalposts={totalGoalposts}
        title={goalpost!.title}
        objective={goalpost!.objective}
        estimatedMinutes={goalpost!.estimatedMinutes}
        experienceLabel={EXPERIENCE_LABELS[expType]}
        beginHref="/journey/goalpost?phase=information"
      />
    );
  }

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
          ~{goalpost!.estimatedMinutes} min &middot;{" "}
          {phase === "information"
            ? "Read"
            : phase === "experience"
              ? "Do"
              : "Feedback"}
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
        <InformationView
          stepId={informationStep.id}
          action={completeInformationStepAction}
          content={<Markdown>{content}</Markdown>}
        />
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
        {/* Experience surface (B.6 Q4): visually distinct from the calm reading
            surface -- a left accent and cooler ground signal "now you do". */}
        <Card
          variant="outlined"
          sx={{
            borderLeft: 6,
            borderLeftColor: "primary.main",
            bgcolor: "background.paper",
          }}
        >
          <CardContent sx={{ p: { xs: 3, md: 4 } }}>
            <ExperienceForm
              stepId={experienceStep.id}
              action={submitExperienceStepAction}
              prompt={<Markdown>{prompt}</Markdown>}
            />
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
            <Typography variant="h6" component="p" sx={{ fontWeight: 400, lineHeight: 1.5 }}>
              {evaluation.rationale}
            </Typography>
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
          <SubmitButton
            variant="contained"
            size="large"
            pendingLabel="Moving you forward…"
          >
            Continue to next goalpost
          </SubmitButton>
        </form>
      )}

      {decision === Decision.repeat && (
        <Stack spacing={2}>
          <form action={repeatGoalpostAction}>
            <input type="hidden" name="goalpostId" value={goalpost!.id} />
            <SubmitButton
              variant="contained"
              color="warning"
              size="large"
              pendingLabel="Setting up another attempt…"
            >
              Try again
            </SubmitButton>
          </form>
          <OverrideControl
            goalpostId={goalpost!.id}
            action={overrideDecisionAction}
          />
        </Stack>
      )}

      {decision === Decision.adjust_plan && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Based on this, we think the plan itself should change rather than
            asking you to keep retrying. We will revise the path to better fit
            where you are.
          </Typography>
          <form action={adjustPlanAction}>
            <input type="hidden" name="goalpostId" value={goalpost!.id} />
            <SubmitButton
              variant="contained"
              color="info"
              size="large"
              pendingLabel="Revising your path…"
            >
              Revise my path
            </SubmitButton>
          </form>
          <OverrideControl
            goalpostId={goalpost!.id}
            action={overrideDecisionAction}
          />
        </Stack>
      )}
    </Stack>
  );
}
