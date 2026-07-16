import type { Goalpost, LearningIntent, Step } from "@prisma/client";
import { prisma } from '@/lib/db';

export { prisma };

export const PAUSE_AFTER_DAYS = 7;
export const ABANDON_AFTER_DAYS = 30;
export const REFRESHER_OFFER_AFTER_DAYS = 21;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysSince(when: Date, now: Date = new Date()): number {
  return (now.getTime() - when.getTime()) / MS_PER_DAY;
}

/**
 * Lazily apply the inactivity state machine to a single intent, based on
 * `updatedAt`. Only acts on `in_progress`/`paused` journeys. `> 30d` idle ->
 * `abandoned` (returns null); `> 7d` idle and `in_progress` -> `paused`.
 * Returns the (possibly updated) intent, or null when abandoned. `now`
 * defaults to the runtime clock and is injectable for tests.
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
  // Addressable resume: an explicit intent id (from `?j=<id>`) loads THAT
  // journey, ownership-checked in the `where` clause so a user can't open
  // another user's journey by guessing an id. Terminal statuses excluded.
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
  // Route is addressable by journey id (`?j=<id>`), resolved by
  // getOrCreateActiveIntent — otherwise every card links to a generic
  // id-less route and clicking journey A could open journey B.
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
