import type { GoalpostPlan, PathOutlinerInput } from "@/lib/services/types";

export interface PathOutliner {
  outline(input: PathOutlinerInput): Promise<GoalpostPlan[]>;
}
