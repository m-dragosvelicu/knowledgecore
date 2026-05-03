import type { Decision } from "@prisma/client";
import type {
  CheckpointEvaluator,
  EvaluationResult,
  EvaluatorInput,
  EvidenceQuote,
  RubricScores,
} from "@/lib/services/types";

const ARITHMETIC_PATTERN = /\d+\s*[+\-*/=]\s*\d+/;

function pickQuotes(artifact: string): [string, string] {
  const trimmed = artifact.trim();
  if (trimmed.length === 0) {
    return ["(empty artifact)", "(empty artifact)"];
  }
  const sentences = trimmed
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const first = sentences[0] ?? trimmed.slice(0, 80);
  const last = sentences[sentences.length - 1] ?? trimmed.slice(-80);
  return [first.slice(0, 160), last.slice(0, 160)];
}

function uniformScores(level: 0 | 1 | 2 | 3 | 4): RubricScores {
  return {
    recall: level,
    application: level,
    conceptual: level,
    transfer: level,
    communication: level,
    coverage: level,
  };
}

export class MockCheckpointEvaluator implements CheckpointEvaluator {
  async evaluate(input: EvaluatorInput): Promise<EvaluationResult> {
    const artifact = input.userArtifact ?? "";
    const length = artifact.trim().length;
    const hasArithmetic = ARITHMETIC_PATTERN.test(artifact);
    const [quoteA, quoteB] = pickQuotes(artifact);

    let scores: RubricScores;
    let decision: Decision;
    let rationale: string;

    if (length < 20) {
      scores = uniformScores(1);
      scores.recall = 0;
      scores.application = 0;
      decision = input.attempt >= 2 ? "adjust_plan" : "repeat";
      rationale =
        decision === "adjust_plan"
          ? `Artifact is still under 20 characters on attempt ${input.attempt}; the plan likely targets the wrong prerequisite. Adjusting the path.`
          : `Artifact is under 20 characters; insufficient evidence of recall or application. Asking the learner to retry.`;
    } else if (length < 150) {
      scores = {
        recall: 3,
        application: 3,
        conceptual: 2,
        transfer: 2,
        communication: 3,
        coverage: 3,
      };
      decision = "advance";
      rationale = `Artifact is concise (${length} chars) and demonstrates proficient recall and application across the goalpost objective "${input.goalpostObjective.slice(0, 80)}". Advancing.`;
    } else {
      const apply: 0 | 1 | 2 | 3 | 4 = hasArithmetic ? 4 : 3;
      scores = {
        recall: 4,
        application: apply,
        conceptual: 3,
        transfer: 3,
        communication: 4,
        coverage: 3,
      };
      decision = "advance";
      rationale = `Artifact is detailed (${length} chars)${hasArithmetic ? " and contains worked arithmetic" : ""}; learner shows advanced recall and application of "${input.goalpostTitle}". Advancing.`;
    }

    const evidence: EvidenceQuote[] = [
      { dimension: "application", quote: quoteA },
      { dimension: "communication", quote: quoteB },
    ];

    return { scores, evidence, decision, rationale };
  }
}
