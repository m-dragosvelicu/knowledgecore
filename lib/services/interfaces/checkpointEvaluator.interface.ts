import type { EvaluationResult, EvaluatorInput } from "@/lib/services/types";

export interface CheckpointEvaluator {
  evaluate(input: EvaluatorInput): Promise<EvaluationResult>;
}
