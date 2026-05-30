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
} from "@/lib/services/types";
import { Motivation, StepType, GoalpostStatus, JourneyStatus } from "@prisma/client";

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

const probeAnswersSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string(),
      response: z.string(),
    }),
  ),
});

export async function submitProbeAction(answers: ProbeAnswer[]): Promise<void> {
  const userId = await requireUserId();
  const intentId = await requireActiveIntentId(userId);
  const parsed = probeAnswersSchema.parse({ answers });

  const services = getServices();
  // Re-derive questions so the scorer can match the subject (mock relies on this).
  const subject = await prisma.subject.findUnique({ where: { intentId } });
  const outcome = await prisma.expectedOutcome.findUnique({ where: { intentId } });
  if (subject && outcome) {
    const canDo = outcome.canDoStatements as unknown as CanDoStatement[];
    await services.knowledgeProbe.questions(
      { canonicalName: subject.canonicalName, scopeNote: subject.scopeNote },
      canDo,
    );
  }

  const competencies = await services.knowledgeProbe.score(parsed.answers);

  await prisma.knowledgeAssessment.upsert({
    where: { intentId },
    update: { competencies: competencies as unknown as object },
    create: { intentId, competencies: competencies as unknown as object },
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

  const services = getServices();
  const evaluation = await services.checkpointEvaluator.evaluate({
    goalpostTitle: step.goalpost.title,
    goalpostObjective: step.goalpost.objective,
    informationContent,
    experiencePrompt,
    userArtifact: parsed.userArtifact,
    attempt: previousAttempts + 1,
  });

  await prisma.checkpointEvaluation.create({
    data: {
      goalpostId: step.goalpostId,
      attempt: previousAttempts + 1,
      scores: evaluation.scores as unknown as object,
      evidence: evaluation.evidence as unknown as object,
      decision: evaluation.decision,
      rationale: evaluation.rationale,
    },
  });

  void intentId;
  redirect("/journey/goalpost");
}

const goalpostIdSchema = z.object({ goalpostId: z.string() });

export async function advanceGoalpostAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const intentId = await requireActiveIntentId(userId);
  const { goalpostId } = goalpostIdSchema.parse({
    goalpostId: formData.get("goalpostId"),
  });

  await prisma.goalpost.update({
    where: { id: goalpostId },
    data: { status: GoalpostStatus.complete },
  });

  // Find the next pending goalpost in the same path.
  const completed = await prisma.goalpost.findUnique({
    where: { id: goalpostId },
    select: { pathId: true, order: true },
  });
  if (!completed) {
    redirect("/journey/goalpost");
  }
  const next = await prisma.goalpost.findFirst({
    where: {
      pathId: completed!.pathId,
      order: { gt: completed!.order },
      status: { not: GoalpostStatus.complete },
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

export async function repeatGoalpostAction(formData: FormData): Promise<void> {
  await requireUserId();
  const { goalpostId } = goalpostIdSchema.parse({
    goalpostId: formData.get("goalpostId"),
  });

  // Reset the experience step in this goalpost so the user can retry.
  const goalpost = await prisma.goalpost.findUnique({
    where: { id: goalpostId },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  if (!goalpost) redirect("/journey/goalpost");
  const experience = goalpost!.steps.find((s) => s.type !== StepType.information);
  if (experience) {
    await prisma.step.update({
      where: { id: experience.id },
      data: { userArtifact: null, completedAt: null },
    });
  }
  redirect("/journey/goalpost");
}

export async function adjustPlanAction(formData: FormData): Promise<void> {
  // Path adjuster not implemented in mock mode — end the journey gracefully.
  const userId = await requireUserId();
  const intentId = await requireActiveIntentId(userId);
  void formData;
  await prisma.learningIntent.update({
    where: { id: intentId },
    data: { status: JourneyStatus.complete },
  });
  redirect("/journey/complete");
}

// ---------------------------------------------------------------------------
// Helper used by the goalpost page to re-fetch
// ---------------------------------------------------------------------------

export async function loadCurrentGoalpost(intentId: string) {
  return getCurrentGoalpost(intentId);
}
