import { redirect } from "next/navigation";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { getCurrentSession, isAnonymousSession } from "@/lib/auth";
import { GATE_REDIRECT } from "@/lib/auth-guards";
import {
  getCurrentGoalpost,
  getOrCreateActiveIntent,
  prisma,
} from "@/lib/journey/state";
import { getPresenter, applyPace } from "@/lib/journey/presenter";
import {
  adjustPlanAction,
  advanceGoalpostAction,
  completeInformationStepAction,
  markVisualNotHelpfulAction,
  overrideDecisionAction,
  prepareGoalpostContentAction,
  readGoalpostGenerationStateAction,
  repeatGoalpostAction,
  skipGoalpostAction,
  submitExperienceStepAction,
} from "@/app/(app)/journey/_actions";
import { isLessonContentReady } from "@/lib/journey/lessonGeneration";
import { estimateReadMinutes } from "@/lib/journey/readTime";
import { isLessonDoc } from "@/lib/services/lessonDoc";
import type { LessonDoc } from "@/lib/services/lessonDoc";
import LessonDocView from "@/components/journey/LessonDocView";
import GettingReady from "@/components/journey/GettingReady";
import RubricGrid from "@/app/(app)/journey/_components/RubricGrid";
import SubmitButton from "@/components/journey/SubmitButton";
import SaveAndLeaveRow from "@/components/journey/SaveAndLeave";
import ExperienceForm from "@/components/journey/ExperienceForm";
import InformationView from "@/components/journey/InformationView";
import OverrideControl from "@/components/journey/OverrideControl";
import SkipControl from "@/components/journey/SkipControl";
import ThresholdView from "@/components/journey/ThresholdView";
import ReviewView from "@/components/journey/ReviewView";
import Markdown from "@/components/Markdown";
import { Decision, StepType } from "@prisma/client";
import type { EvidenceQuote, RubricScores } from "@/lib/services/types";
import { Eyebrow, HeadlineUnderline, ScoreBadge } from "@/components/ui";
import SolidButton from "@/components/ui/SolidButton";
import SourcesPanel from "@/components/journey/SourcesPanel";

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
  j?: string;
}>;

export default async function GoalpostPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = (await searchParams) ?? {};
  // Authoritative anon-guest gate: a guest's cookie passes optimistic middleware,
  // so a deep-linked guest is bounced to create-account here.
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/signin");
  if (isAnonymousSession(session)) redirect(GATE_REDIRECT);
  const intent = await getOrCreateActiveIntent(session.user.id, params.j);
  if (!intent) redirect("/journey/intent");

  // §9.5: a journey that lazily transitioned to `paused` (>7d idle) gets a
  // warm-up recap first. The review sub-view is exempt so a paused journey can
  // still be browsed read-only from the path trail.
  if (intent.status === "paused" && !params.review) {
    redirect(`/journey/resume?j=${intent.id}`);
  }

  // Read-only review of a completed goalpost (B.6 §5.1), handled before the
  // in_progress redirect so a finished journey is still reviewable.
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
      const reviewPayload = infoStep?.payload as unknown;
      // Read-only block-walk: no not-helpful control in review.
      const information: React.ReactNode | null = isLessonDoc(reviewPayload) ? (
        <LessonDocView doc={reviewPayload} intentId={intent.id} />
      ) : null;
      const promptContent =
        (expStep?.payload as { prompt?: string } | null)?.prompt ?? "";
      const latest = reviewed.evaluations[0];
      return (
        <ReviewView
          order={reviewed.order}
          title={reviewed.title}
          objective={reviewed.objective}
          information={information}
          prompt={promptContent ? <Markdown>{promptContent}</Markdown> : null}
          userArtifact={expStep?.userArtifact ?? null}
          decisionLabel={latest ? DECISION_LABELS[latest.decision] : null}
          decisionColor={latest ? DECISION_COLORS[latest.decision] : "default"}
          rationale={latest?.rationale ?? null}
          intentId={intent.id}
        />
      );
    }
    redirect(`/journey/path?j=${intent.id}`);
  }

  if (intent.status === "complete") redirect(`/journey/complete?j=${intent.id}`);

  const goalpost = await getCurrentGoalpost(intent.id);
  if (!goalpost) redirect(`/journey/path?j=${intent.id}`);

  const informationStep = goalpost!.steps.find((s) => s.type === StepType.information);
  const experienceStep = goalpost!.steps.find((s) => s.type !== StepType.information);

  // Threshold sub-view (B.6 §1.1): shown before the information phase for a
  // goalpost not yet opened. "Fresh" = info step incomplete AND no evaluation;
  // ?phase=information (or ?begin=1) transitions past it.
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
        beginHref={`/journey/goalpost?phase=information&j=${intent.id}`}
      />
    );
  }

  let phase: "information" | "experience" | "evaluation" = "evaluation";
  if (informationStep && !informationStep.completedAt) {
    phase = "information";
  } else if (experienceStep && !experienceStep.userArtifact) {
    phase = "experience";
  }

  const header = (
    <Stack spacing={1.5}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
        <Eyebrow>
          Goalpost {goalpost!.order} &middot; ~{goalpost!.estimatedMinutes} min
          &middot;{" "}
          {phase === "information"
            ? "read"
            : phase === "experience"
              ? "build"
              : "checkpoint"}
        </Eyebrow>
        <SourcesPanel journeyId={intent.id} />
      </Stack>
      <HeadlineUnderline>
        <Typography variant="h3" component="h1">
          {goalpost!.title}
        </Typography>
      </HeadlineUnderline>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: "62ch" }}>
        {goalpost!.objective}
      </Typography>
    </Stack>
  );

  // Information sub-view
  if (phase === "information" && informationStep) {
    // Lazy generation: the lesson (Call B) is authored against the freshest
    // profile when the learner enters the goalpost. If not generated yet, the
    // "getting things ready" screen triggers generation and refreshes back here.
    const contentReady = await isLessonContentReady(goalpost!.id);
    if (!contentReady) {
      return (
        <Stack spacing={4}>
          {header}
          <GettingReady
            goalpostId={goalpost!.id}
            intentId={intent.id}
            title={goalpost!.title}
            action={prepareGoalpostContentAction}
            pollAction={readGoalpostGenerationStateAction}
          />
        </Stack>
      );
    }
    const lessonDoc = informationStep.payload as unknown as LessonDoc;
    // Presenter seam: profile is not yet persisted, so we pass null and the
    // default pass-through strategy leaves the dwell gate at 6s.
    const directives = getPresenter().directivesFor(
      { type: informationStep.type },
      null,
    );
    const dwellSeconds = applyPace(6, directives.paceMultiplier);
    return (
      <Stack spacing={4}>
        {header}
        <InformationView
          stepId={informationStep.id}
          intentId={intent.id}
          action={completeInformationStepAction}
          content={
            <LessonDocView
              doc={lessonDoc}
              intentId={intent.id}
              onNotHelpful={markVisualNotHelpfulAction}
            />
          }
          dwellSeconds={dwellSeconds}
          readMinutes={estimateReadMinutes(lessonDoc)}
        />
        {/* §9.2 skip-with-confirm, available during the information phase. */}
        <SkipControl goalpostId={goalpost!.id} intentId={intent.id} action={skipGoalpostAction} />
      </Stack>
    );
  }

  // Experience sub-view
  if (phase === "experience" && experienceStep) {
    const prompt = (experienceStep.payload as { prompt?: string } | null)?.prompt ?? "";
    return (
      <Stack spacing={4}>
        {header}
        {/* Recessed surface distinguishes "now you build" from the reading paper. */}
        <Box
          sx={{
            bgcolor: "var(--surface-experience)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-lg)",
            p: { xs: "28px 24px", md: "44px 48px" },
          }}
        >
          <ExperienceForm
            stepId={experienceStep.id}
            intentId={intent.id}
            action={submitExperienceStepAction}
            prompt={<Markdown>{prompt}</Markdown>}
          />
        </Box>
        {/* §9.2 skip-with-confirm, available during the experience phase. */}
        <SkipControl goalpostId={goalpost!.id} intentId={intent.id} action={skipGoalpostAction} />
      </Stack>
    );
  }

  // Evaluation sub-view
  const evaluation = await prisma.checkpointEvaluation.findFirst({
    where: { goalpostId: goalpost!.id },
    orderBy: { createdAt: "desc" },
  });

  if (!evaluation) {
    return (
      <Stack spacing={4}>
        {header}
        <Box
          sx={{
            bgcolor: "var(--surface-2)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-md)",
            p: "20px 22px",
          }}
        >
          <Typography variant="body1" color="text.secondary">
            No checkpoint result yet. Head back and submit the build to get your
            score.
          </Typography>
        </Box>
      </Stack>
    );
  }

  const scores = evaluation.scores as unknown as RubricScores;
  const evidence = evaluation.evidence as unknown as EvidenceQuote[];
  const decision = evaluation.decision;

  // Average of the six rubric dimensions, rounded to the /4 scale each is scored on.
  const scoreValues = Object.values(scores) as number[];
  const overallScore =
    scoreValues.length > 0
      ? Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length)
      : 0;
  const advanced = decision === Decision.advance;

  return (
    <Stack spacing={4}>
      {header}

      <Box
        sx={{
          bgcolor: "background.paper",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-lg)",
          boxShadow: "var(--shadow-sm)",
          p: { xs: "28px 24px", md: "40px 44px" },
        }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={{ xs: 3, sm: 4 }}
          alignItems={{ sm: "flex-start" }}
        >
          <Box sx={{ flexShrink: 0 }}>
            {/* Always the rounded rubric average: there is no points concept
                for "+1" to refer to, and an earned advance deserves its real
                number just as much as a repeat does. */}
            <ScoreBadge big={`${overallScore}`} sub="of 4" />
          </Box>
          <Stack spacing={1.5}>
            {advanced ? (
              <HeadlineUnderline>
                <Typography variant="h4" component="p">
                  That&rsquo;s knowledge now
                </Typography>
              </HeadlineUnderline>
            ) : (
              <Typography variant="h4" component="p">
                {decision === Decision.repeat
                  ? "Close. One more pass"
                  : "Let’s reshape the plan"}
              </Typography>
            )}
            <Eyebrow>
              {DECISION_LABELS[decision]} &middot; attempt {evaluation.attempt}
            </Eyebrow>
            <Typography
              variant="body1"
              sx={{
                fontFamily: "var(--font-read)",
                fontSize: "16.5px",
                lineHeight: 1.65,
                color: "var(--ink-2)",
                maxWidth: "58ch",
              }}
            >
              {evaluation.rationale}
            </Typography>
          </Stack>
        </Stack>
      </Box>

      <Box>
        <Eyebrow sx={{ mb: 2 }}>How your build scored</Eyebrow>
        <RubricGrid scores={scores} evidence={evidence} />
      </Box>

      {/* Advance is the solid commit; repeat/adjust stay outlined because they keep
          you working rather than move you on. */}
      {decision === Decision.advance && (
        <form action={advanceGoalpostAction}>
          <input type="hidden" name="j" value={intent.id} />
          <input type="hidden" name="goalpostId" value={goalpost!.id} />
          <SaveAndLeaveRow>
            <SubmitButton
              variant="contained"
              color="kcInk"
              size="large"
              pendingLabel="Moving you forward…"
            >
              Continue to the next goalpost
            </SubmitButton>
          </SaveAndLeaveRow>
        </form>
      )}

      {decision === Decision.repeat && (
        <Stack spacing={2} alignItems="flex-start">
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: "58ch" }}>
            You&rsquo;re close. Another pass through the build will close the gap.
          </Typography>
          <form action={repeatGoalpostAction}>
            <input type="hidden" name="j" value={intent.id} />
            <input type="hidden" name="goalpostId" value={goalpost!.id} />
            <SubmitButton
              variant="outlined"
              size="large"
              pendingLabel="Setting up another attempt…"
            >
              Try this build again
            </SubmitButton>
          </form>
          <OverrideControl
            goalpostId={goalpost!.id}
            intentId={intent.id}
            action={overrideDecisionAction}
          />
        </Stack>
      )}

      {decision === Decision.adjust_plan && (
        <Stack spacing={2} alignItems="flex-start">
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: "58ch" }}>
            The honest move here is to change the plan rather than ask you to keep
            retrying. We&rsquo;ll revise the path to better fit where you are.
          </Typography>
          <form action={adjustPlanAction}>
            <input type="hidden" name="j" value={intent.id} />
            <input type="hidden" name="goalpostId" value={goalpost!.id} />
            <SubmitButton
              variant="outlined"
              size="large"
              pendingLabel="Revising your path…"
            >
              Reshape my path
            </SubmitButton>
          </form>
          <OverrideControl
            goalpostId={goalpost!.id}
            intentId={intent.id}
            action={overrideDecisionAction}
          />
        </Stack>
      )}
    </Stack>
  );
}
