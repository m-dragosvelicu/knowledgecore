import type { GoalInterviewInput, InterviewStep } from "@/lib/services/types";

export interface GoalInterviewer {
  // Multi-turn (L0.md §5): given the subject, motivation, and the transcript so
  // far, return the next InterviewStep. Terminates with kind="complete" once a
  // time horizon and >=3 can-do statements have been gathered (capped at ~6
  // assistant questions).
  interview(input: GoalInterviewInput): Promise<InterviewStep>;
}
