import type { LearningIntent } from "@prisma/client";

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
