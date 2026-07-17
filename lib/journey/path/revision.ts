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
 * transaction; same code path as scripts/verify-loop.ts.
 *
 * adjust_plan means the plan was wrong, not the learner: current goalpost is
 * completed, removed goalposts are marked `skipped` (history preserved),
 * modifications applied in place, inserts land right after the current
 * order. The @@unique([pathId, order]) constraint is respected by bumping
 * later goalposts out of the way (large offset), inserting contiguously,
 * then renumbering the bumped ones to follow. Records a PathRevision, bumps
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

  // Defense-in-depth: the Zod schema (pathAdjuster.service.ts) already requires
  // insertedGoalposts.length >= 1, but never trust a single layer with silently
  // advancing a learner past a goalpost they never passed. Refuse and roll back
  // rather than stamp complete with nothing to remediate the gap.
  if (adjustment.insertedGoalposts.length === 0) {
    throw new Error(
      "applyPathAdjustment: adjustment has no insertedGoalposts; refusing to " +
        "mark the current goalpost complete without a remediation goalpost.",
    );
  }

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

/**
 * Apply a PathAdjustment to a DRAFT path during the L1 Slice 2 Path
 * Confirmation gate, before the learner has accepted the path or started any
 * goalpost. Reuses the same `PathAdjustment` shape as `applyPathAdjustment`,
 * but application semantics differ: there is no "current goalpost" to
 * complete, so nothing is marked `complete`. Inserts land at their requested
 * order, then the whole path is renumbered contiguously from 1 (skipped rows
 * excluded, pushed to the end) so @@unique([pathId, order]) always holds.
 * Records a PathRevision with triggerEvalId = null (trigger was a
 * confirmation conversation, not a checkpoint evaluation).
 */
export async function applyPreAcceptancePathAdjustment(
  tx: Prisma.TransactionClient,
  args: {
    pathId: string;
    adjustment: PathAdjustment;
  },
): Promise<void> {
  const { pathId, adjustment } = args;

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

  // Insert new goalposts. To avoid colliding with existing orders mid-insert we
  // first bump every existing goalpost out of the way by a large offset, create
  // the inserts at their requested orders, then renumber the whole non-skipped
  // path contiguously from 1 (skipped rows are parked at the high end).
  if (adjustment.insertedGoalposts.length) {
    const OFFSET = 100000;
    const existing = await tx.goalpost.findMany({
      where: { pathId },
      orderBy: { order: "asc" },
    });
    for (const g of existing) {
      await tx.goalpost.update({
        where: { id: g.id },
        data: { order: g.order + OFFSET },
      });
    }
    for (const gp of adjustment.insertedGoalposts) {
      await tx.goalpost.create({
        data: {
          pathId,
          order: gp.order,
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
    }
  }

  // Contiguous renumber: active (non-skipped) goalposts get 1..N in their current
  // order; skipped goalposts are pushed past them (history, never served). Done
  // via a temporary offset pass so we never transiently violate the unique
  // constraint while resequencing.
  const TEMP = 200000;
  const all = await tx.goalpost.findMany({
    where: { pathId },
    orderBy: { order: "asc" },
  });
  for (const g of all) {
    await tx.goalpost.update({
      where: { id: g.id },
      data: { order: g.order + TEMP },
    });
  }
  const active = all.filter((g) => g.status !== GoalpostStatus.skipped);
  const skipped = all.filter((g) => g.status === GoalpostStatus.skipped);
  let nextOrder = 1;
  for (const g of active) {
    await tx.goalpost.update({ where: { id: g.id }, data: { order: nextOrder } });
    nextOrder += 1;
  }
  for (const g of skipped) {
    await tx.goalpost.update({ where: { id: g.id }, data: { order: nextOrder } });
    nextOrder += 1;
  }

  await tx.pathRevision.create({
    data: {
      pathId,
      triggerEvalId: null,
      changes: adjustment as unknown as object,
    },
  });
  await tx.learningPath.update({
    where: { id: pathId },
    data: { revisionCount: { increment: 1 } },
  });
}
