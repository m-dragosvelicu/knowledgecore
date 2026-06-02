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
import { getVisualResolvers } from "@/lib/services";
import { routeVisuals } from "@/lib/services/visual/gate";
import type { VisualNeed } from "@/lib/services/visualMedia";
import type { LessonDoc, Section } from "@/lib/services/lessonDoc";
import VisualMedia from "@/components/journey/VisualMedia";
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

// L1 — Two-Phase Visual Lesson Pipeline (Slice 4). A new-shape information-step
// payload carries a LessonDoc ({ sections, contentGeneratedAt }) whose visual
// blocks already hold their RESOLVED payload inline. This narrows such a payload
// to a LessonDoc the block-walk renderer (LessonDocView) walks in document order.
// The block-walk REPLACES the old flatten-prose + append-visuals glue; the legacy
// { content, visuals } path is kept for rows that have not regenerated yet.
type InfoPayload = {
  content?: string;
  visuals?: VisualNeed[];
  sections?: Section[];
  contentGeneratedAt?: string;
} | null;

function lessonDocFromPayload(payload: InfoPayload): LessonDoc | null {
  if (!Array.isArray(payload?.sections)) return null;
  return {
    sections: payload.sections,
    contentGeneratedAt: payload.contentGeneratedAt ?? "",
  };
}

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
  // Learning surface: reject anonymous guests (a guest's session cookie passes
  // the optimistic middleware check, so the authoritative gate is here). A guest
  // who deep-links the goalpost is bounced to the create-account step.
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/signin");
  if (isAnonymousSession(session)) redirect(GATE_REDIRECT);
  const intent = await getOrCreateActiveIntent(session.user.id, params.j);
  if (!intent) redirect("/journey/intent");

  // §9.5 multi-session continuity: a journey that lazily transitioned to
  // `paused` (>7d idle, see lib/journey/state.ts) gets a warm-up recap BEFORE
  // being dropped back into the goalpost. The review sub-view below is exempt
  // so a paused journey can still be browsed read-only from the path trail.
  if (intent.status === "paused" && !params.review) {
    redirect(`/journey/resume?j=${intent.id}`);
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
      const reviewPayload = infoStep?.payload as InfoPayload;
      // New-shape rows block-walk the LessonDoc read-only (no not-helpful control
      // in review); legacy rows keep the flat-markdown recap.
      const reviewDoc = lessonDocFromPayload(reviewPayload);
      const legacyInfo = reviewPayload?.content ?? "";
      const information: React.ReactNode | null = reviewDoc ? (
        <LessonDocView doc={reviewDoc} intentId={intent.id} />
      ) : legacyInfo ? (
        <Markdown>{legacyInfo}</Markdown>
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
        beginHref={`/journey/goalpost?phase=information&j=${intent.id}`}
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
            intentId={intent.id}
            title={goalpost!.title}
            action={prepareGoalpostContentAction}
            pollAction={readGoalpostGenerationStateAction}
          />
        </Stack>
      );
    }
    const infoPayload = informationStep.payload as InfoPayload;
    // L1 — Two-Phase Visual Lesson Pipeline (Slice 4). A freshly generated
    // goalpost carries a LessonDoc ({ sections, contentGeneratedAt }) whose visual
    // blocks already hold their RESOLVED payload inline (resolution happened in
    // the pipeline, not at render). Such a row takes the BLOCK-WALK renderer
    // (LessonDocView), which interleaves prose and each visual in document order
    // and never shows a pending/dropped block (reveal invariant, redesign §5).
    const lessonDoc = lessonDocFromPayload(infoPayload);
    // Legacy rows (no `sections`): resolve the lesson's visual NEEDS through the
    // gate server-side (each visualKind -> safe medium) and render the flat
    // markdown + appended visuals exactly as before. New LessonDoc rows carry
    // resolved payloads inline, so they skip this gate-resolve path entirely.
    const legacyContent = lessonDoc ? "" : (infoPayload?.content ?? "");
    const visualNeeds =
      !lessonDoc && Array.isArray(infoPayload?.visuals) ? infoPayload!.visuals : [];
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
          intentId={intent.id}
          action={completeInformationStepAction}
          content={
            lessonDoc ? (
              // New-shape: walk the LessonDoc, interleaving prose and each ready
              // visual in document order (reveal-invariant guarded inside).
              <LessonDocView
                doc={lessonDoc}
                intentId={intent.id}
                onNotHelpful={markVisualNotHelpfulAction}
              />
            ) : (
              // Legacy { content, visuals }: flat markdown + gate-resolved visuals
              // appended in a trailing block, exactly as before.
              <>
                <Markdown>{legacyContent}</Markdown>
                {resolvedVisuals.length > 0 && (
                  <Stack spacing={2} sx={{ mt: 3 }}>
                    {resolvedVisuals.map((v) => (
                      <VisualMedia
                        key={v.id}
                        visual={v}
                        intentId={intent.id}
                        onNotHelpful={markVisualNotHelpfulAction}
                      />
                    ))}
                  </Stack>
                )}
              </>
            )
          }
          dwellSeconds={dwellSeconds}
        />
        {/* §9.2 skip-with-confirm: available during the information phase. */}
        <SkipControl goalpostId={goalpost!.id} intentId={intent.id} action={skipGoalpostAction} />
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
            intentId={intent.id}
            action={submitExperienceStepAction}
            prompt={<Markdown>{prompt}</Markdown>}
          />
        </Box>
        {/* §9.2 skip-with-confirm: available during the experience phase. */}
        <SkipControl goalpostId={goalpost!.id} intentId={intent.id} action={skipGoalpostAction} />
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
