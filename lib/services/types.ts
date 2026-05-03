import type { Decision, Motivation, StepType } from "@prisma/client";

export type ParsedSubject = {
  canonicalName: string;
  scopeNote: string;
};

export type CanDoStatement = {
  text: string;
  bloomLevel: "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
};

export type Competency = {
  competency: string;
  estimatedLevel: 0 | 1 | 2 | 3 | 4;
  confidence: number;
};

export type ProbeQuestion = {
  id: string;
  prompt: string;
  kind: "open" | "multiple_choice";
  options?: string[];
  competencyTag: string;
};

export type ProbeAnswer = {
  questionId: string;
  response: string;
};

export type GoalpostPlan = {
  order: number;
  title: string;
  objective: string;
  estimatedMinutes: number;
  steps: Array<{
    order: number;
    type: StepType;
    payload: Record<string, unknown>;
  }>;
};

export type RubricScores = {
  recall: 0 | 1 | 2 | 3 | 4;
  application: 0 | 1 | 2 | 3 | 4;
  conceptual: 0 | 1 | 2 | 3 | 4;
  transfer: 0 | 1 | 2 | 3 | 4;
  communication: 0 | 1 | 2 | 3 | 4;
  coverage: 0 | 1 | 2 | 3 | 4;
};

export type EvidenceQuote = {
  dimension: keyof RubricScores;
  quote: string;
};

export type EvaluationResult = {
  scores: RubricScores;
  evidence: EvidenceQuote[];
  decision: Decision;
  rationale: string;
};

// =====================================================================
// Service interfaces — see L0.md §5
// =====================================================================

export interface IntentParser {
  parse(rawText: string): Promise<ParsedSubject>;
}

export type GoalInterviewInput = {
  subject: ParsedSubject;
  motivation: Motivation;
  elaboration: string;
  timeHorizon?: string;
};

export interface GoalInterviewer {
  interview(input: GoalInterviewInput): Promise<{
    canDoStatements: CanDoStatement[];
  }>;
}

export interface KnowledgeProbe {
  questions(subject: ParsedSubject, outcome: CanDoStatement[]): Promise<ProbeQuestion[]>;
  score(answers: ProbeAnswer[]): Promise<Competency[]>;
}

export type PathOutlinerInput = {
  subject: ParsedSubject;
  motivation: Motivation;
  outcome: CanDoStatement[];
  assessment: Competency[];
};

export interface PathOutliner {
  outline(input: PathOutlinerInput): Promise<GoalpostPlan[]>;
}

export type EvaluatorInput = {
  goalpostTitle: string;
  goalpostObjective: string;
  informationContent: string;
  experiencePrompt: string;
  userArtifact: string;
  attempt: number;
};

export interface CheckpointEvaluator {
  evaluate(input: EvaluatorInput): Promise<EvaluationResult>;
}

// =====================================================================
// Service registry — selects mock vs live based on env
// =====================================================================

export type Services = {
  intentParser: IntentParser;
  goalInterviewer: GoalInterviewer;
  knowledgeProbe: KnowledgeProbe;
  pathOutliner: PathOutliner;
  checkpointEvaluator: CheckpointEvaluator;
  mode: "mock" | "live";
};
