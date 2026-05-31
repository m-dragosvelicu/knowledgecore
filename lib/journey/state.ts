import type { Goalpost, LearningIntent, Step } from "@prisma/client";
import { prisma } from "@/lib/db";

export { prisma };

export async function getOrCreateActiveIntent(
  userId: string,
): Promise<LearningIntent | null> {
  return prisma.learningIntent.findFirst({
    where: {
      userId,
      status: { notIn: ["complete", "abandoned"] },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export function nextWizardRoute(intent: LearningIntent | null): string {
  if (!intent) return "/journey/intent";
  switch (intent.status) {
    case "created":
      return "/journey/intent";
    case "goal_assessed":
      return "/journey/outcome";
    case "outcome_assessed":
      return "/journey/probe";
    case "knowledge_assessed":
      return "/journey/path";
    case "path_outlined":
      return "/journey/path";
    case "in_progress":
      return "/journey/goalpost";
    case "paused":
      return "/journey/goalpost";
    case "complete":
      return "/journey/complete";
    case "abandoned":
      return "/journey/intent";
    default:
      return "/journey/intent";
  }
}

export type GoalpostWithSteps = Goalpost & { steps: Step[] };

export async function getCurrentGoalpost(
  intentId: string,
): Promise<GoalpostWithSteps | null> {
  const path = await prisma.learningPath.findUnique({
    where: { intentId },
    select: { id: true },
  });
  if (!path) return null;
  return prisma.goalpost.findFirst({
    // Serve the lowest-order goalpost that is not done. "skipped" goalposts
    // (dropped by a path revision) are terminal like "complete".
    where: { pathId: path.id, status: { notIn: ["complete", "skipped"] } },
    orderBy: { order: "asc" },
    include: { steps: { orderBy: { order: "asc" } } },
  });
}
