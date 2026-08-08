import type { Goalpost, Step } from "@prisma/client";
import { prisma } from '@/lib/db';
import { TERMINAL_GOALPOST_STATUSES } from "@/lib/journey/path/revision";

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
    // Serve the lowest-order goalpost that is not done. "skipped"/"superseded"
    // goalposts (dropped or superseded by a path revision) are terminal like
    // "complete".
    where: { pathId: path.id, status: { notIn: TERMINAL_GOALPOST_STATUSES } },
    orderBy: { order: "asc" },
    include: { steps: { orderBy: { order: "asc" } } },
  });
}
