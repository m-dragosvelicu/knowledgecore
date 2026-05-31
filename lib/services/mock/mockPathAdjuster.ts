import type {
  PathAdjuster,
  PathAdjusterInput,
  PathAdjustment,
} from "@/lib/services/types";

/**
 * Heuristic mock for the adjust_plan branch (L0.md §7). Inserts a single
 * remediation goalpost that re-targets the objective the learner stalled on,
 * with a Socratic experience focused on interpretation rather than another
 * mechanical attempt. Keeps all remaining goalposts intact (minimal-edit).
 */
export class MockPathAdjuster implements PathAdjuster {
  async adjust(input: PathAdjusterInput): Promise<PathAdjustment> {
    const insertOrder = input.currentGoalpost.order + 1;
    return {
      insertedGoalposts: [
        {
          order: insertOrder,
          title: `Shore up: ${input.currentGoalpost.title}`,
          objective: `Revisit the prerequisite ideas behind "${input.currentGoalpost.objective}" from a different angle before moving on.`,
          estimatedMinutes: 30,
          steps: [
            {
              order: 1,
              type: "information",
              payload: {
                content: `Let's slow down and rebuild the foundation for **${input.currentGoalpost.title}**. We'll focus on the single idea that tripped up the last attempt, then check understanding with a short discussion rather than another drill.`,
                sourceIds: [],
              },
            },
            {
              order: 2,
              type: "experience_socratic",
              payload: {
                prompt: `In your own words, explain the core idea behind "${input.currentGoalpost.title}" as if teaching a friend. What is it for, and where would it break down?`,
                rubricFocus: ["conceptual", "communication"],
              },
            },
          ],
        },
      ],
      removedOrders: [],
      modifiedGoalposts: [],
      rationale: `We've added a short refresher on "${input.currentGoalpost.title}" so the next step builds on solid ground.`,
    };
  }
}
