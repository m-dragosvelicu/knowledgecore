import type { Prisma } from "@prisma/client";
import { GoalpostStatus } from "@prisma/client";
import type { PathAdjustment } from "@/lib/services/types";

// Goalpost statuses that mean "done, do not serve again".
export const TERMINAL_GOALPOST_STATUSES = [
  GoalpostStatus.complete,
  GoalpostStatus.skipped,
];

/**
 * Apply a minimal-edit PathAdjustment (L0.md §7 adjust_plan) inside a
 * transaction. Extracted from the server action so the exact same code is
 * exercised by scripts/verify-loop.ts.
 *
 * Semantics: adjust_plan acknowledges the PLAN was wrong, not the learner — the
 * current goalpost is completed and the learner is moved into the inserted
 * remediation. Removed goalposts are marked `skipped` (history preserved);
 * modifications are applied in place; inserted goalposts land right after the
 * current order. The @@unique([pathId, order]) constraint is respected by
 * vacating the range (large offset bump), inserting contiguously, then
 * renumbering the bumped goalposts to follow. Records a PathRevision and bumps
 * revisionCount.
 */
export async function applyPathAdjustment(
  tx: Prisma.TransactionClient,
  args: {
    pathId: string;
    currentGoalpostId: string;
    currentOrder: number;
    adjustment: PathAdjustment;
    triggerEvalId: string | null;
  },
): Promise<void> {
  const { pathId, currentGoalpostId, currentOrder, adjustment, triggerEvalId } = args;

  await tx.goalpost.update({
    where: { id: currentGoalpostId },
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
      triggerEvalId,
      changes: adjustment as unknown as object,
    },
  });
  await tx.learningPath.update({
    where: { id: pathId },
    data: { revisionCount: { increment: 1 } },
  });
}
