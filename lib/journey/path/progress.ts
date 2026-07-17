import { GoalpostStatus } from "@prisma/client";

/**
 * A goalpost still counts toward a path's progress denominator only if a
 * learner could actually reach or pass it. `skipped` (dropped by a reshape)
 * and `superseded` (stamped complete-without-passing by a reshape - founder
 * ruling 2026-07-17) are both off the path, not merely "done". Every
 * "N of M goalposts" / total-minutes display must filter through this
 * instead of counting `goalposts.length` directly.
 */
export function isOnPath(status: GoalpostStatus): boolean {
  return (
    status !== GoalpostStatus.skipped && status !== GoalpostStatus.superseded
  );
}

export type GoalpostProgress = { done: number; total: number };

// "N of M" progress: M = goalposts actually on the path, N = the subset of
// those genuinely passed (status complete).
export function countGoalpostProgress(
  goalposts: { status: GoalpostStatus }[],
): GoalpostProgress {
  const onPath = goalposts.filter((g) => isOnPath(g.status));
  const done = onPath.filter((g) => g.status === GoalpostStatus.complete).length;
  return { done, total: onPath.length };
}

// Sum of estimatedMinutes across on-path goalposts only (skipped/superseded
// goalposts are no longer part of what the learner will actually do).
export function sumOnPathMinutes(
  goalposts: { status: GoalpostStatus; estimatedMinutes: number }[],
): number {
  return goalposts
    .filter((g) => isOnPath(g.status))
    .reduce((sum, g) => sum + g.estimatedMinutes, 0);
}

/**
 * 1-indexed ordinal position of `goalpostId` among on-path goalposts, plus
 * the on-path total. `goalposts` must already be ordered by `order` asc.
 * Keeps "Goalpost N of M" copy contiguous even when a reshape has dropped or
 * superseded goalposts elsewhere on the path.
 */
export function onPathOrdinal(
  goalposts: { id: string; status: GoalpostStatus }[],
  goalpostId: string,
): { ordinal: number; total: number } {
  const onPath = goalposts.filter((g) => isOnPath(g.status));
  const index = onPath.findIndex((g) => g.id === goalpostId);
  return { ordinal: index === -1 ? 0 : index + 1, total: onPath.length };
}
