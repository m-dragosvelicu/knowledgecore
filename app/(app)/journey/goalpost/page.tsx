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
  repeatGoalpostAction,
  skipGoalpostAction,
  submitExperienceStepAction,
} from "@/app/(app)/journey/_actions";
import { isLessonContentReady } from "@/lib/journey/lessonGeneration";
import { getVisualResolvers } from "@/lib/services";
import { routeVisuals } from "@/lib/services/visual/gate";
import type { VisualNeed } from "@/lib/services/visualMedia";
import VisualMedia from "@/components/journey/VisualMedia";
import GettingReady from "@/components/journey/GettingReady";
import RubricGrid from "@/app/(app)/journey/_components/RubricGrid";
import SubmitButton from "@/components/journey/SubmitButton";
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

// Decision tone collapses onto the one-teal vocabulary (no traffic light):
// advance is a quiet teal "done/forward", repeat and adjust are neutral notes
// carried by copy and the workbench action, not by a warning hue.
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
  // Learning surface: reject anonymous guests (a guest's session cookie passes
  // the optimistic middleware check, so the authoritative gate is here). A guest
  // who deep-links the goalpost is bounced to the create-account step.
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/signin");
  if (isAnonymousSession(session)) redirect(GATE_REDIRECT);
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
    <Stack spacing={1.5}>
      <Eyebrow>
        Goalpost {goalpost!.order} &middot; ~{goalpost!.estimatedMinutes} min
        &middot;{" "}
        {phase === "information"
          ? "read"
          : phase === "experience"
            ? "build"
            : "checkpoint"}
      </Eyebrow>
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

  // -----------------------------------------------------------------------
  // Information sub-view
  // -----------------------------------------------------------------------
  if (phase === "information" && informationStep) {
    // L1 LAZY GENERATION: the lesson content (Call B) is authored against the
    // freshest profile when the learner enters the goalpost. If it has not been
    // generated yet (pre-generation on advance missed, or this is the first
    // goalpost just after accepting the path), show the "getting things ready"
    // screen, which triggers generation and refreshes back here.
    const contentReady = await isLessonContentReady(goalpost!.id);
    if (!contentReady) {
      return (
        <Stack spacing={4}>
          {header}
          <GettingReady
            goalpostId={goalpost!.id}
            title={goalpost!.title}
            action={prepareGoalpostContentAction}
          />
        </Stack>
      );
    }
    const infoPayload = informationStep.payload as
      | { content?: string; visuals?: VisualNeed[] }
      | null;
    const content = infoPayload?.content ?? "";
    // L1 Slice 4 — resolve the lesson's visual NEEDS through the gate, server-side:
    // each visualKind routes to a safe medium (SVG sanitized on its OWN dedicated
    // path, image sourced license-clean with attribution, video as a reference
    // embed). The SVG NEVER passes through the markdown sanitizer. `none` results
    // (no license-clean image, empty SVG after sanitization) render nothing.
    const visualNeeds = Array.isArray(infoPayload?.visuals) ? infoPayload!.visuals : [];
    const resolvedVisuals =
      visualNeeds.length > 0
        ? await routeVisuals(visualNeeds, getVisualResolvers())
        : [];
    // L1 presenter seam: ask the active strategy how to render this step, then
    // apply the directives at the render boundary. The learner profile is not
    // yet persisted (Backend owns that schema), so we pass null — the default
    // pass-through strategy ignores it and returns identity directives, leaving
    // the dwell gate at its current 6s.
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
          action={completeInformationStepAction}
          content={
            <>
              <Markdown>{content}</Markdown>
              {resolvedVisuals.length > 0 && (
                <Stack spacing={2} sx={{ mt: 3 }}>
                  {resolvedVisuals.map((v) => (
                    <VisualMedia
                      key={v.id}
                      visual={v}
                      onNotHelpful={markVisualNotHelpfulAction}
                    />
                  ))}
                </Stack>
              )}
            </>
          }
          dwellSeconds={dwellSeconds}
        />
        {/* §9.2 skip-with-confirm: available during the information phase. */}
        <SkipControl goalpostId={goalpost!.id} action={skipGoalpostAction} />
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
        {/* Experience surface (B.6 Q4 / decided): the recessed --surface-2 ground
            distinguishes "now you build" from the calm reading paper -- a surface
            shift, not a new hue. */}
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
            action={submitExperienceStepAction}
            prompt={<Markdown>{prompt}</Markdown>}
          />
        </Box>
        {/* §9.2 skip-with-confirm: available during the experience phase. */}
        <SkipControl goalpostId={goalpost!.id} action={skipGoalpostAction} />
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

  // The checkpoint score, shown in the roughened ScoreBadge as a considered
  // judgment (Fraunces figure), not a system readout. Average of the six rubric
  // dimensions, rounded to /4 the way each dimension is scored.
  const scoreValues = Object.values(scores) as number[];
  const overallScore =
    scoreValues.length > 0
      ? Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length)
      : 0;
  const advanced = decision === Decision.advance;

  return (
    <Stack spacing={4}>
      {header}

      {/* The result, on the system surface: the roughened score badge carries the
          judgment, the rationale reads in calm Hanken. The decision tone stays on
          the one-teal vocabulary -- no traffic-light borders. */}
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
            <ScoreBadge
              big={advanced ? `+1` : `${overallScore}`}
              sub={advanced ? "score" : "of 4"}
            />
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

      {/* Advance is the solid commit. Repeat / adjust are workbench-tier: quieter
          outlined actions, because they keep you working rather than move you on. */}
      {decision === Decision.advance && (
        <form action={advanceGoalpostAction}>
          <input type="hidden" name="goalpostId" value={goalpost!.id} />
          <SubmitButton
            variant="contained"
            color="kcInk"
            size="large"
            pendingLabel="Moving you forward…"
          >
            Continue to the next goalpost
          </SubmitButton>
        </form>
      )}

      {decision === Decision.repeat && (
        <Stack spacing={2} alignItems="flex-start">
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: "58ch" }}>
            You&rsquo;re close. Another pass through the build will close the gap.
          </Typography>
          <form action={repeatGoalpostAction}>
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
            action={overrideDecisionAction}
          />
        </Stack>
      )}
    </Stack>
  );
}
