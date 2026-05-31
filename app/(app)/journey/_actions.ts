"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { prisma, getOrCreateActiveIntent, getCurrentGoalpost } from "@/lib/journey/state";
import { getServices } from "@/lib/services";
import type {
  CanDoStatement,
  Competency,
  InterviewStep,
  InterviewTurn,
  ProbeAnswer,
  ProbeQuestion,
} from "@/lib/services/types";
import { Motivation, StepType, GoalpostStatus, JourneyStatus, Decision } from "@prisma/client";
import { deriveDecision } from "@/lib/journey/decision";
import { applyPathAdjustment, TERMINAL_GOALPOST_STATUSES } from "@/lib/journey/pathRevision";
import type { RubricScores } from "@/lib/services/types";

async function requireUserId(): Promise<string> {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    redirect("/signin");
  }
  return session.user.id;
}

async function requireActiveIntentId(userId: string): Promise<string> {
  const intent = await getOrCreateActiveIntent(userId);
  if (!intent) {
    redirect("/journey/intent");
  }
  return intent.id;
}

// L0.md §7: a repeat / adjust_plan is a signal that the initial assessment
// under-estimated effort (or missed a prerequisite). Record it on the
// KnowledgeAssessment for later calibration. Best-effort; never blocks the flow.
async function appendRecalibrationFlag(intentId: string, flag: string): Promise<void> {
  try {
    const assessment = await prisma.knowledgeAssessment.findUnique({
      where: { intentId },
    });
    if (!assessment) return;
    const existing = Array.isArray(assessment.recalibrationFlags)
      ? (assessment.recalibrationFlags as unknown as string[])
      : [];
    await prisma.knowledgeAssessment.update({
      where: { intentId },
      data: { recalibrationFlags: [...existing, flag] as unknown as object },
    });
  } catch {
    // calibration telemetry is non-critical; do not break the journey
  }
}

// ---------------------------------------------------------------------------
// Start a new learning intent (from landing page)
// ---------------------------------------------------------------------------

export async function startNewJourneyAction(): Promise<void> {
  const userId = await requireUserId();
  // Mark any in-progress journey as abandoned so the new one is the active one.
  await prisma.learningIntent.updateMany({
    where: { userId, status: { notIn: ["complete", "abandoned"] } },
    data: { status: "abandoned" },
  });
  await prisma.learningIntent.create({
    data: {
      userId,
      rawText: "",
      status: "created",
    },
  });
  redirect("/journey/intent");
}

// ---------------------------------------------------------------------------
// Stage 2 — submit intent text
// ---------------------------------------------------------------------------

const submitIntentSchema = z.object({
  rawText: z.string().min(3, "Please describe what you want to learn."),
});

export async function submitIntentAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const parsed = submitIntentSchema.parse({
    rawText: formData.get("rawText"),
  });

  const services = getServices();
  const subject = await services.intentParser.parse(parsed.rawText);

  // Find or create the active intent.
  const existing = await getOrCreateActiveIntent(userId);
  const intent = existing
    ? await prisma.learningIntent.update({
        where: { id: existing.id },
        data: { rawText: parsed.rawText, status: "goal_assessed" },
      })
    : await prisma.learningIntent.create({
        data: { userId, rawText: parsed.rawText, status: "goal_assessed" },
      });

  await prisma.subject.upsert({
    where: { intentId: intent.id },
    update: { canonicalName: subject.canonicalName, scopeNote: subject.scopeNote },
    create: {
      intentId: intent.id,
      canonicalName: subject.canonicalName,
      scopeNote: subject.scopeNote,
    },
  });

  // L0.md §3 Stage 2: do NOT silently narrow an ambiguous intent. When the
  // parser flagged the input as too vague / too broad / two-intents-in-one, send
  // the learner back to the intent page in a confirm/refine sub-view (the
  // clarification is transient, so it rides along on the query string). A clear,
  // singular intent flows straight through to the outcome interview as before.
  if (subject.ambiguous) {
    const params = new URLSearchParams({ confirm: "1" });
    if (subject.clarification) params.set("note", subject.clarification);
    redirect(`/journey/intent?${params.toString()}`);
  }

  redirect("/journey/outcome");
}

// Confirm an ambiguous intent as-is and proceed to the outcome interview. The
// subject was already persisted by submitIntentAction; this just acknowledges
// the learner accepted the parser's best interpretation.
export async function confirmIntentAction(): Promise<void> {
  const userId = await requireUserId();
  const intentId = await requireActiveIntentId(userId);
  const subject = await prisma.subject.findUnique({ where: { intentId } });
  if (!subject) redirect("/journey/intent");
  redirect("/journey/outcome");
}

// ---------------------------------------------------------------------------
// Stages 3+4 — submit goal + outcome
// ---------------------------------------------------------------------------

// --- Multi-turn goal interview (L0.md §3 Stage 3+4, §5 Goal Interview Agent) ---
//
// The interview is a turn loop driven by the client, which holds the running
// transcript and re-sends it each turn (mirrors ProbeClient's stateless shape).
// `advanceInterviewAction` returns the next InterviewStep; `finalizeOutcomeAction`
// persists the synthesized outcome and moves the journey forward.

const interviewTurnSchema = z.object({
  role: z.enum(["assistant", "user"]),
  content: z.string(),
});

const advanceInterviewSchema = z.object({
  motivation: z.nativeEnum(Motivation),
  transcript: z.array(interviewTurnSchema),
});

// Best-effort numeric horizon parse for LearningGoal.timeHorizonDays (L0.md §4
// path-budget constraint). Recognizes simple "<n> day/week/month" phrasings; the
// raw user phrasing is always preserved separately in LearningGoal.timeHorizon.
function parseTimeHorizonDays(text: string): number | null {
  const m = text.toLowerCase().match(/(\d+)\s*(day|week|month|year)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2];
  const perUnit =
    unit === "day" ? 1 : unit === "week" ? 7 : unit === "month" ? 30 : 365;
  return n * perUnit;
}

// Most recent learner free-text answer in the transcript (seeds elaboration).
function latestUserText(transcript: InterviewTurn[]): string {
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i].role === "user") return transcript[i].content.trim();
  }
  return "";
}

/**
 * Advance the interview by one turn. Upserts LearningGoal (motivation + latest
 * learner free-text as elaboration + best-effort timeHorizon) as the interview
 * progresses, then returns the next InterviewStep for the client to render.
 */
export async function advanceInterviewAction(
  motivation: Motivation,
  transcript: InterviewTurn[],
): Promise<InterviewStep> {
  const userId = await requireUserId();
  const intentId = await requireActiveIntentId(userId);
  const parsed = advanceInterviewSchema.parse({ motivation, transcript });

  const subject = await prisma.subject.findUnique({ where: { intentId } });
  if (!subject) redirect("/journey/intent");

  // Persist what we know so far. elaboration is required (non-null) in the
  // schema, so default to a placeholder until the learner has answered.
  const elaboration = latestUserText(parsed.transcript) || "(in progress)";
  const horizonDays = parseTimeHorizonDays(elaboration);
  await prisma.learningGoal.upsert({
    where: { intentId },
    update: {
      motivation: parsed.motivation,
      elaboration,
      ...(horizonDays !== null
        ? { timeHorizon: elaboration, timeHorizonDays: horizonDays }
        : {}),
    },
    create: {
      intentId,
      motivation: parsed.motivation,
      elaboration,
      timeHorizon: horizonDays !== null ? elaboration : null,
      timeHorizonDays: horizonDays,
    },
  });

  const services = getServices();
  return services.goalInterviewer.interview({
    subject: { canonicalName: subject!.canonicalName, scopeNote: subject!.scopeNote },
    motivation: parsed.motivation,
    transcript: parsed.transcript,
  });
}

const finalizeOutcomeSchema = z.object({
  canDoStatements: z
    .array(
      z.object({
        text: z.string().min(1),
        bloomLevel: z.enum([
          "remember",
          "understand",
          "apply",
          "analyze",
          "evaluate",
          "create",
        ]),
      }),
    )
    .min(1),
  successCriterion: z.string().min(1),
});

/**
 * Finalize the interview: persist the confirmed can-do statements + success
 * criterion to ExpectedOutcome, mark the intent outcome_assessed, and proceed to
 * the probe.
 */
export async function finalizeOutcomeAction(
  canDoStatements: CanDoStatement[],
  successCriterion: string,
): Promise<void> {
  const userId = await requireUserId();
  const intentId = await requireActiveIntentId(userId);
  const parsed = finalizeOutcomeSchema.parse({ canDoStatements, successCriterion });

  await prisma.expectedOutcome.upsert({
    where: { intentId },
    update: {
      canDoStatements: parsed.canDoStatements,
      successCriterion: parsed.successCriterion,
    },
    create: {
      intentId,
      canDoStatements: parsed.canDoStatements,
      successCriterion: parsed.successCriterion,
    },
  });

  await prisma.learningIntent.update({
    where: { id: intentId },
    data: { status: "outcome_assessed" },
  });

  redirect("/journey/probe");
}

// ---------------------------------------------------------------------------
// Stage 5 — submit probe answers
// ---------------------------------------------------------------------------

const probeQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  kind: z.enum(["open", "multiple_choice"]),
  options: z.array(z.string()).optional(),
  competencyTag: z.string(),
});

const probeSubmissionSchema = z.object({
  questions: z.array(probeQuestionSchema),
  answers: z.array(
    z.object({
      questionId: z.string(),
      response: z.string(),
    }),
  ),
});

export async function submitProbeAction(
  questions: ProbeQuestion[],
  answers: ProbeAnswer[],
): Promise<void> {
  const userId = await requireUserId();
  const intentId = await requireActiveIntentId(userId);
  const parsed = probeSubmissionSchema.parse({ questions, answers });

  const services = getServices();
  // Stateless scoring: pass the exact questions the learner answered. No
  // regeneration (which previously produced mismatched questions and 0/4 scores).
  const { competencies, transcript } = await services.knowledgeProbe.score(
    parsed.questions,
    parsed.answers,
  );

  await prisma.knowledgeAssessment.upsert({
    where: { intentId },
    update: {
      competencies: competencies as unknown as object,
      probeTranscript: transcript as unknown as object,
    },
    create: {
      intentId,
      competencies: competencies as unknown as object,
      probeTranscript: transcript as unknown as object,
    },
  });

  await prisma.learningIntent.update({
    where: { id: intentId },
    data: { status: "knowledge_assessed" },
  });

  redirect("/journey/path");
}

// ---------------------------------------------------------------------------
// Stage 6 — generate / accept path
// ---------------------------------------------------------------------------

export async function generatePathAction(): Promise<void> {
  const userId = await requireUserId();
  const intentId = await requireActiveIntentId(userId);

  const existing = await prisma.learningPath.findUnique({ where: { intentId } });
  if (existing) {
    return;
  }

  const subject = await prisma.subject.findUnique({ where: { intentId } });
  const goal = await prisma.learningGoal.findUnique({ where: { intentId } });
  const outcome = await prisma.expectedOutcome.findUnique({ where: { intentId } });
  const assessment = await prisma.knowledgeAssessment.findUnique({ where: { intentId } });
  if (!subject || !goal || !outcome || !assessment) {
    return;
  }

  const services = getServices();
  const goalposts = await services.pathOutliner.outline({
    subject: { canonicalName: subject.canonicalName, scopeNote: subject.scopeNote },
    motivation: goal.motivation,
    outcome: outcome.canDoStatements as unknown as CanDoStatement[],
    assessment: assessment.competencies as unknown as Competency[],
  });

  await prisma.learningPath.create({
    data: {
      intentId,
      goalposts: {
        create: goalposts.map((gp) => ({
          order: gp.order,
          title: gp.title,
          objective: gp.objective,
          estimatedMinutes: gp.estimatedMinutes,
          steps: {
            create: gp.steps.map((s) => ({
              order: s.order,
              type: s.type,
              payload: s.payload as object,
            })),
          },
        })),
      },
    },
  });

  await prisma.learningIntent.update({
    where: { id: intentId },
    data: { status: "path_outlined" },
  });
}

export async function acceptPathAction(): Promise<void> {
  const userId = await requireUserId();
  const intentId = await requireActiveIntentId(userId);

  await prisma.learningPath.update({
    where: { intentId },
    data: { acceptedAt: new Date() },
  });
  await prisma.learningIntent.update({
    where: { id: intentId },
    data: { status: "in_progress" },
  });
  // Activate the first goalpost.
  const path = await prisma.learningPath.findUnique({
    where: { intentId },
    include: { goalposts: { orderBy: { order: "asc" } } },
  });
  const first = path?.goalposts[0];
  if (first && first.status === "pending") {
    await prisma.goalpost.update({
      where: { id: first.id },
      data: { status: "in_progress" },
    });
  }
  redirect("/journey/goalpost");
}

// ---------------------------------------------------------------------------
// Stage 7 — goalpost step transitions
// ---------------------------------------------------------------------------

const completeStepSchema = z.object({ stepId: z.string() });

export async function completeInformationStepAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  await requireActiveIntentId(userId);
  const { stepId } = completeStepSchema.parse({ stepId: formData.get("stepId") });

  await prisma.step.update({
    where: { id: stepId },
    data: { completedAt: new Date() },
  });
  redirect("/journey/goalpost");
}

const submitExperienceSchema = z.object({
  stepId: z.string(),
  userArtifact: z.string().min(1, "Please provide an answer."),
});

export async function submitExperienceStepAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const intentId = await requireActiveIntentId(userId);
  const parsed = submitExperienceSchema.parse({
    stepId: formData.get("stepId"),
    userArtifact: formData.get("userArtifact"),
  });

  const step = await prisma.step.update({
    where: { id: parsed.stepId },
    data: {
      userArtifact: parsed.userArtifact,
      completedAt: new Date(),
    },
    include: { goalpost: { include: { steps: { orderBy: { order: "asc" } } } } },
  });

  // Find sibling information step content + this experience prompt for the evaluator.
  const informationStep = step.goalpost.steps.find((s) => s.type === StepType.information);
  const informationContent =
    (informationStep?.payload as { content?: string } | null)?.content ?? "";
  const experiencePrompt =
    (step.payload as { prompt?: string } | null)?.prompt ?? "";

  // Determine attempt count (existing evaluations + 1).
  const previousAttempts = await prisma.checkpointEvaluation.count({
    where: { goalpostId: step.goalpostId },
  });

  const attempt = previousAttempts + 1;
  const services = getServices();
  const evaluation = await services.checkpointEvaluator.evaluate({
    goalpostTitle: step.goalpost.title,
    goalpostObjective: step.goalpost.objective,
    informationContent,
    experiencePrompt,
    userArtifact: parsed.userArtifact,
    attempt,
  });

  // The evaluator's own `decision` is advisory. The authoritative branch is
  // derived deterministically from the rubric scores per L0.md §8, which also
  // enforces the §9.6 repeat cap independently of model behaviour.
  const decision = deriveDecision(evaluation.scores, attempt);

  await prisma.checkpointEvaluation.create({
    data: {
      goalpostId: step.goalpostId,
      attempt,
      scores: evaluation.scores as unknown as object,
      evidence: evaluation.evidence as unknown as object,
      decision,
      rationale: evaluation.rationale,
    },
  });

  void intentId;
  redirect("/journey/goalpost");
}

const goalpostIdSchema = z.object({ goalpostId: z.string() });

// Shared advance core: complete the given goalpost, then either activate the
// next non-terminal goalpost or finish the journey. Returns the redirect target
// (the caller performs the redirect outside any try/catch).
async function doAdvance(intentId: string, goalpostId: string): Promise<string> {
  await prisma.goalpost.update({
    where: { id: goalpostId },
    data: { status: GoalpostStatus.complete },
  });
  const completed = await prisma.goalpost.findUnique({
    where: { id: goalpostId },
    select: { pathId: true, order: true },
  });
  if (!completed) return "/journey/goalpost";

  const next = await prisma.goalpost.findFirst({
    where: {
      pathId: completed.pathId,
      order: { gt: completed.order },
      status: { notIn: TERMINAL_GOALPOST_STATUSES },
    },
    orderBy: { order: "asc" },
  });
  if (next) {
    await prisma.goalpost.update({
      where: { id: next.id },
      data: { status: GoalpostStatus.in_progress },
    });
    return "/journey/goalpost";
  }

  await prisma.learningIntent.update({
    where: { id: intentId },
    data: { status: JourneyStatus.complete },
  });
  return "/journey/complete";
}

// --- skip-with-confirm (L0.md §9.2; CEO override: allow skip with confirmation,
// "you'll be assessed on prerequisites later"). Marks the current goalpost
// `skipped` (NOT `complete`, unlike doAdvance) and then runs doAdvance's
// "activate next or finish" tail. getCurrentGoalpost already excludes skipped
// goalposts, so the next non-terminal goalpost becomes the active one.
export async function skipGoalpostAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const intentId = await requireActiveIntentId(userId);
  const { goalpostId } = goalpostIdSchema.parse({
    goalpostId: formData.get("goalpostId"),
  });

  const skipped = await prisma.goalpost.update({
    where: { id: goalpostId },
    data: { status: GoalpostStatus.skipped },
    select: { pathId: true, order: true },
  });

  const next = await prisma.goalpost.findFirst({
    where: {
      pathId: skipped.pathId,
      order: { gt: skipped.order },
      status: { notIn: TERMINAL_GOALPOST_STATUSES },
    },
    orderBy: { order: "asc" },
  });
  if (next) {
    await prisma.goalpost.update({
      where: { id: next.id },
      data: { status: GoalpostStatus.in_progress },
    });
    redirect("/journey/goalpost");
  }

  await prisma.learningIntent.update({
    where: { id: intentId },
    data: { status: JourneyStatus.complete },
  });
  redirect("/journey/complete");
}

export async function advanceGoalpostAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const intentId = await requireActiveIntentId(userId);
  const { goalpostId } = goalpostIdSchema.parse({
    goalpostId: formData.get("goalpostId"),
  });

  // Server-side guard (defense in depth): only advance if the latest evaluation
  // actually says advance, or the learner has explicitly overridden it.
  const latestEval = await prisma.checkpointEvaluation.findFirst({
    where: { goalpostId },
    orderBy: { createdAt: "desc" },
  });
  if (latestEval && latestEval.decision !== Decision.advance && !latestEval.userOverride) {
    redirect("/journey/goalpost");
  }

  const target = await doAdvance(intentId, goalpostId);
  redirect(target);
}

// --- repeat: swap the experience for a Socratic retry on the weakest dimension

const DIMENSION_FOCUS: Record<keyof RubricScores, string> = {
  recall: "the key facts and terms involved",
  application: "how you would actually carry out the procedure, step by step",
  conceptual: "what is really going on underneath, explained in your own words",
  transfer: "how this idea would apply to a slightly different situation",
  communication: "your reasoning, laid out clearly enough that someone else could follow it",
  coverage: "how this connects back to the goalpost's objective",
};

// Lowest-scoring dimension excluding coverage (coverage drives adjust_plan, not repeat).
function weakestDimension(scores: RubricScores): keyof RubricScores {
  const dims: (keyof RubricScores)[] = [
    "recall",
    "application",
    "conceptual",
    "transfer",
    "communication",
  ];
  let weakest = dims[0];
  for (const d of dims) {
    if (scores[d] < scores[weakest]) weakest = d;
  }
  return weakest;
}

function buildSocraticRetryPrompt(
  objective: string,
  weakest: keyof RubricScores,
): string {
  const focus = DIMENSION_FOCUS[weakest];
  const obj = objective.replace(/\.$/, "");
  return [
    `Let's try this from a different angle. Instead of another exercise, talk me through your thinking.`,
    ``,
    `Focusing on ${focus}: in your own words, explain ${obj}.`,
    ``,
    `Go step by step and don't worry about being formal - I want to follow how you're reasoning about it.`,
  ].join("\n");
}

export async function repeatGoalpostAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const intentId = await requireActiveIntentId(userId);
  const { goalpostId } = goalpostIdSchema.parse({
    goalpostId: formData.get("goalpostId"),
  });

  const goalpost = await prisma.goalpost.findUnique({
    where: { id: goalpostId },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  if (!goalpost) redirect("/journey/goalpost");

  // Per L0.md §7: on repeat, swap the experience step for a Socratic one
  // focused on interpretation of the weakest rubric dimension, rather than
  // re-serving the same exercise. The information step stays completed.
  const latestEval = await prisma.checkpointEvaluation.findFirst({
    where: { goalpostId },
    orderBy: { createdAt: "desc" },
  });
  const experience = goalpost!.steps.find((s) => s.type !== StepType.information);
  if (experience) {
    const resetData: {
      userArtifact: null;
      completedAt: null;
      type?: StepType;
      payload?: object;
    } = { userArtifact: null, completedAt: null };

    if (latestEval) {
      const scores = latestEval.scores as unknown as RubricScores;
      const weak = weakestDimension(scores);
      resetData.type = StepType.experience_socratic;
      resetData.payload = {
        prompt: buildSocraticRetryPrompt(goalpost!.objective, weak),
        rubricFocus: [weak],
      };
    }

    await prisma.step.update({
      where: { id: experience.id },
      data: resetData,
    });
  }

  await appendRecalibrationFlag(
    intentId,
    `Goalpost "${goalpost!.title}" repeated - initial assessment may have under-estimated effort here.`,
  );
  redirect("/journey/goalpost");
}

// --- adjust_plan: minimal-edit revision of the remaining path (live PathAdjuster)

export async function adjustPlanAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const intentId = await requireActiveIntentId(userId);
  const { goalpostId } = goalpostIdSchema.parse({
    goalpostId: formData.get("goalpostId"),
  });

  const goalpost = await prisma.goalpost.findUnique({ where: { id: goalpostId } });
  if (!goalpost) redirect("/journey/goalpost");
  const pathId = goalpost!.pathId;
  const currentOrder = goalpost!.order;

  const [latestEval, subject, goal, outcome, assessment, remaining] =
    await Promise.all([
      prisma.checkpointEvaluation.findFirst({
        where: { goalpostId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.subject.findUnique({ where: { intentId } }),
      prisma.learningGoal.findUnique({ where: { intentId } }),
      prisma.expectedOutcome.findUnique({ where: { intentId } }),
      prisma.knowledgeAssessment.findUnique({ where: { intentId } }),
      prisma.goalpost.findMany({
        where: {
          pathId,
          order: { gt: currentOrder },
          status: { notIn: TERMINAL_GOALPOST_STATUSES },
        },
        orderBy: { order: "asc" },
      }),
    ]);

  // Without full context (or an evaluation) we cannot adjust honestly — fall
  // back to completing the journey rather than fabricating a revision.
  if (!latestEval || !subject || !goal || !outcome || !assessment) {
    await prisma.learningIntent.update({
      where: { id: intentId },
      data: { status: JourneyStatus.complete },
    });
    redirect("/journey/complete");
  }

  const services = getServices();
  const adjustment = await services.pathAdjuster.adjust({
    subject: { canonicalName: subject!.canonicalName, scopeNote: subject!.scopeNote },
    motivation: goal!.motivation,
    outcome: outcome!.canDoStatements as unknown as CanDoStatement[],
    assessment: assessment!.competencies as unknown as Competency[],
    currentGoalpost: {
      order: currentOrder,
      title: goalpost!.title,
      objective: goalpost!.objective,
    },
    triggerScores: latestEval!.scores as unknown as RubricScores,
    triggerRationale: latestEval!.rationale,
    remainingGoalposts: remaining.map((g) => ({
      order: g.order,
      title: g.title,
      objective: g.objective,
      estimatedMinutes: g.estimatedMinutes,
    })),
  });

  await prisma.$transaction((tx) =>
    applyPathAdjustment(tx, {
      pathId,
      currentGoalpostId: goalpostId,
      currentOrder,
      adjustment,
      triggerEvalId: latestEval!.id,
    }),
  );

  await appendRecalibrationFlag(
    intentId,
    `Plan revised at goalpost "${goalpost!.title}" - a coverage or prerequisite gap was surfaced that the assessment missed.`,
  );

  // L0.md §7 Q7: show a must-acknowledge "we've adjusted your path" notice
  // before dropping the learner into the revised path.
  redirect("/journey/adjusted");
}

// --- user override of an evaluator decision (L0.md §7 / §4 userOverride) -----

const overrideSchema = z.object({
  goalpostId: z.string(),
  newDecision: z.nativeEnum(Decision),
  reason: z.string().optional(),
});

export async function overrideDecisionAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const intentId = await requireActiveIntentId(userId);
  const parsed = overrideSchema.parse({
    goalpostId: formData.get("goalpostId"),
    newDecision: formData.get("newDecision"),
    reason: formData.get("reason") || undefined,
  });

  const latestEval = await prisma.checkpointEvaluation.findFirst({
    where: { goalpostId: parsed.goalpostId },
    orderBy: { createdAt: "desc" },
  });
  if (!latestEval) redirect("/journey/goalpost");

  // Record the override as a calibration signal (L0.md §7: recorded, not hidden).
  await prisma.checkpointEvaluation.update({
    where: { id: latestEval!.id },
    data: {
      userOverride: {
        newDecision: parsed.newDecision,
        reason: parsed.reason ?? null,
      } as object,
    },
  });

  if (parsed.newDecision === Decision.advance) {
    const target = await doAdvance(intentId, parsed.goalpostId);
    redirect(target);
  }
  redirect("/journey/goalpost");
}

// ---------------------------------------------------------------------------
// Helper used by the goalpost page to re-fetch
// ---------------------------------------------------------------------------

export async function loadCurrentGoalpost(intentId: string) {
  return getCurrentGoalpost(intentId);
}
