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
    case "paused":
      // Founder ruling 2026-07-17: any journey with a confirmed path
      // (goalposts exist once accepted -> in_progress/paused) lands on the
      // full trail by default, not straight into the current goalpost.
      // /journey/goalpost itself still redirects a `paused` journey to
      // /journey/resume for the §9.5 warm-up recap once the learner taps
      // into the current goalpost from the trail — that continuity feature
      // is unchanged, just one tap further from this entry point.
      return withId("/journey/path");
    case "complete":
      return "/journey/complete";
    case "abandoned":
      return "/journey/intent";
    default:
      return "/journey/intent";
  }
}
