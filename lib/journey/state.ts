import type { Goalpost, LearningIntent, Step } from "@prisma/client";
import { prisma } from "@/lib/db";

export { prisma };

// L0 §6 multi-session continuity, implemented WITHOUT a cron/background job.
// Inactivity transitions are evaluated lazily on access (every read of the
// active intent) using the row's `updatedAt` timestamp as the last-activity
// signal. The state machine is: in_progress -> paused (after 7d idle) ->
// abandoned (after 30d idle). We only ever touch in_progress/paused; complete
// and the pre-execution wizard statuses are left alone.
export const PAUSE_AFTER_DAYS = 7;
export const ABANDON_AFTER_DAYS = 30;
// §9.5 / B.6: a long gap offers an OPT-IN refresher on resume (never automatic).
export const REFRESHER_OFFER_AFTER_DAYS = 21;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysSince(when: Date, now: Date = new Date()): number {
  return (now.getTime() - when.getTime()) / MS_PER_DAY;
}

/**
 * Lazily apply the §6 inactivity state machine to a single intent, based on how
 * long ago it was last touched (`updatedAt`). Safe and narrow:
 *  - only acts on `in_progress` / `paused` journeys; never on complete/abandoned
 *    or the pre-execution wizard statuses.
 *  - `> 30d` idle  -> `abandoned` (returns null: it is no longer the active journey).
 *  - `> 7d` idle and currently `in_progress` -> `paused`.
 * Returns the (possibly updated) intent, or null when it became abandoned.
 *
 * This is app/server code (not a workflow script), so `new Date()` at runtime
 * is the intended clock; it is injectable for tests via the `now` parameter.
 */
export async function applyInactivityTransitions(
  intent: LearningIntent,
  now: Date = new Date(),
): Promise<LearningIntent | null> {
  if (intent.status !== "in_progress" && intent.status !== "paused") {
    return intent;
  }

  const idleDays = daysSince(intent.updatedAt, now);

  if (idleDays > ABANDON_AFTER_DAYS) {
    await prisma.learningIntent.update({
      where: { id: intent.id },
      data: { status: "abandoned" },
    });
    return null;
  }

  if (intent.status === "in_progress" && idleDays > PAUSE_AFTER_DAYS) {
    return prisma.learningIntent.update({
      where: { id: intent.id },
      data: { status: "paused" },
    });
  }

  return intent;
}

export async function getOrCreateActiveIntent(
  userId: string,
  intentId?: string | null,
): Promise<LearningIntent | null> {
  // Addressable resume (bug: clicking a journey card opened the most-recent
  // journey, not the clicked one). When the caller passes an explicit intent id
  // (from the `?j=<id>` route param), load THAT journey -- but only if it
  // belongs to the requesting user. Ownership is enforced in the `where` clause
  // (userId must match), so a user can never open another user's journey by
  // guessing an id. A non-terminal status is still required so we don't resume a
  // complete/abandoned journey into the wizard.
  if (intentId) {
    const byId = await prisma.learningIntent.findFirst({
      where: {
        id: intentId,
        userId,
        status: { notIn: ["complete", "abandoned"] },
      },
    });
    if (byId) return applyInactivityTransitions(byId);
    // Not found / not owned / terminal: fall through to the most-recent
    // behavior so a stale or foreign id never strands the learner.
  }

  const intent = await prisma.learningIntent.findFirst({
    where: {
      userId,
      status: { notIn: ["complete", "abandoned"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!intent) return null;
  return applyInactivityTransitions(intent);
}

export function nextWizardRoute(intent: LearningIntent | null): string {
  if (!intent) return "/journey/intent";
  // Make the route ADDRESSABLE by journey id. Each wizard stage resolves which
  // journey to load via getOrCreateActiveIntent, which honors a `?j=<id>` param
  // (falling back to most-recent when absent). Without this, every card linked
  // to a generic, id-less route and the page then loaded whichever journey was
  // touched most recently -- so clicking journey A could open journey B.
  const withId = (path: string) => `${path}?j=${intent.id}`;
  switch (intent.status) {
    case "created":
      return withId("/journey/intent");
    case "goal_assessed":
      return withId("/journey/outcome");
    case "outcome_assessed":
      return withId("/journey/probe");
    case "knowledge_assessed":
      return withId("/journey/path");
    case "path_outlined":
      return withId("/journey/path");
    case "in_progress":
      return withId("/journey/goalpost");
    case "paused":
      // §9.5: a resumed journey gets a warm-up recap before the goalpost.
      return withId("/journey/resume");
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
