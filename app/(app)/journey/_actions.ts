"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { prisma, getOrCreateActiveIntent, getCurrentGoalpost } from "@/lib/journey/state";
import { getServices } from "@/lib/services";
import type {
  CanDoStatement,
  Competency,
  ProbeAnswer,
  ProbeQuestion,
} from "@/lib/services/types";
import { Motivation, StepType, GoalpostStatus, JourneyStatus, Decision } from "@prisma/client";
import { deriveDecision } from "@/lib/journey/decision";
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

  redirect("/journey/outcome");
}

// ---------------------------------------------------------------------------
// Stages 3+4 — submit goal + outcome
// ---------------------------------------------------------------------------

const submitOutcomeSchema = z.object({
  motivation: z.nativeEnum(Motivation),
  elaboration: z.string().min(3, "Please tell us a bit more."),
  timeHorizon: z.string().optional(),
});

export async function submitOutcomeAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const intentId = await requireActiveIntentId(userId);

  const parsed = submitOutcomeSchema.parse({
    motivation: formData.get("motivation"),
    elaboration: formData.get("elaboration"),
    timeHorizon: formData.get("timeHorizon") || undefined,
  });

  const subject = await prisma.subject.findUnique({ where: { intentId } });
  if (!subject) redirect("/journey/intent");

  await prisma.learningGoal.upsert({
    where: { intentId },
    update: {
      motivation: parsed.motivation,
      elaboration: parsed.elaboration,
      timeHorizon: parsed.timeHorizon ?? null,
    },
    create: {
      intentId,
      motivation: parsed.motivation,
      elaboration: parsed.elaboration,
      timeHorizon: parsed.timeHorizon ?? null,
    },
  });

  const services = getServices();
  const interview = await services.goalInterviewer.interview({
    subject: { canonicalName: subject!.canonicalName, scopeNote: subject!.scopeNote },
    motivation: parsed.motivation,
    elaboration: parsed.elaboration,
    timeHorizon: parsed.timeHorizon,
  });

  await prisma.expectedOutcome.upsert({
    where: { intentId },
    update: { canDoStatements: interview.canDoStatements },
    create: { intentId, canDoStatements: interview.canDoStatements },
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

// Goalpost statuses that mean "done, do not serve again".
const TERMINAL_GOALPOST_STATUSES = [
  GoalpostStatus.complete,
  GoalpostStatus.skipped,
];

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
  await requireUserId();
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

  await prisma.$transaction(async (tx) => {
    // adjust_plan acknowledges the PLAN was wrong, not the learner: complete the
    // current goalpost and move them into the inserted remediation.
    await tx.goalpost.update({
      where: { id: goalpostId },
      data: { status: GoalpostStatus.complete },
    });

    if (adjustment.removedOrders.length) {
      await tx.goalpost.updateMany({
        where: { pathId, order: { in: adjustment.removedOrders } },
        data: { status: GoalpostStatus.skipped },
      });
    }

    for (const m of adjustment.modifiedGoalposts) {
      await tx.goalpost.updateMany({
        where: { pathId, order: m.order },
        data: {
          ...(m.title !== undefined ? { title: m.title } : {}),
          ...(m.objective !== undefined ? { objective: m.objective } : {}),
          ...(m.estimatedMinutes !== undefined
            ? { estimatedMinutes: m.estimatedMinutes }
            : {}),
        },
      });
    }

    if (adjustment.insertedGoalposts.length) {
      // Respect @@unique([pathId, order]): vacate the range after the current
      // goalpost by bumping later goalposts out by a large offset, insert the
      // new goalposts contiguously at currentOrder+1, then renumber the bumped
      // ones to follow.
      const OFFSET = 100000;
      const later = await tx.goalpost.findMany({
        where: { pathId, order: { gt: currentOrder } },
        orderBy: { order: "asc" },
      });
      for (const g of later) {
        await tx.goalpost.update({
          where: { id: g.id },
          data: { order: g.order + OFFSET },
        });
      }
      let nextOrder = currentOrder + 1;
      for (const gp of adjustment.insertedGoalposts) {
        await tx.goalpost.create({
          data: {
            pathId,
            order: nextOrder,
            title: gp.title,
            objective: gp.objective,
            estimatedMinutes: gp.estimatedMinutes,
            status: GoalpostStatus.pending,
            steps: {
              create: gp.steps.map((s) => ({
                order: s.order,
                type: s.type,
                payload: s.payload as object,
              })),
            },
          },
        });
        nextOrder += 1;
      }
      const bumped = await tx.goalpost.findMany({
        where: { pathId, order: { gte: OFFSET } },
        orderBy: { order: "asc" },
      });
      for (const g of bumped) {
        await tx.goalpost.update({
          where: { id: g.id },
          data: { order: nextOrder },
        });
        nextOrder += 1;
      }
    }

    await tx.pathRevision.create({
      data: {
        pathId,
        triggerEvalId: latestEval!.id,
        changes: adjustment as unknown as object,
      },
    });
    await tx.learningPath.update({
      where: { id: pathId },
      data: { revisionCount: { increment: 1 } },
    });
  });

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
