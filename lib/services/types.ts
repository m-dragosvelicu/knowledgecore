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

// One scored Q/A row, persisted to KnowledgeAssessment.probeTranscript for the
// §7 calibration loop and as an audit trail for probe-scoring correctness.
export type ProbeTranscriptEntry = {
  question: string;
  answer: string;
  judgement: string;
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

export type ProbeScoreResult = {
  competencies: Competency[];
  transcript: ProbeTranscriptEntry[];
};

export interface KnowledgeProbe {
  questions(subject: ParsedSubject, outcome: CanDoStatement[]): Promise<ProbeQuestion[]>;
  // Stateless scoring: the answered questions are passed in explicitly so scoring
  // never depends on instance state surviving between requests (the root cause of
  // the "all competencies 0/4" bug — a fresh service instance per request lost the
  // questions and the action regenerated mismatched ones).
  score(questions: ProbeQuestion[], answers: ProbeAnswer[]): Promise<ProbeScoreResult>;
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
// Path Adjuster — L0.md §5 / §7 decision branch `adjust_plan`.
// Added to the locked boundary under CEO delegated authority (2026-05-31)
// to close the M6 remediation loop; see DECISIONS-INDEX.
// Minimal-edit principle: prefer inserting/replacing 1-2 goalposts over
// rewriting the tail; keep >=70% of the original remaining path intact.
// =====================================================================

export type RemainingGoalpost = {
  order: number;
  title: string;
  objective: string;
  estimatedMinutes: number;
};

export type PathAdjusterInput = {
  subject: ParsedSubject;
  motivation: Motivation;
  outcome: CanDoStatement[];
  assessment: Competency[];
  // The goalpost that triggered adjust_plan and the evaluation evidence.
  currentGoalpost: { order: number; title: string; objective: string };
  triggerScores: RubricScores;
  triggerRationale: string;
  // Goalposts not yet completed (excluding the current one), in order.
  remainingGoalposts: RemainingGoalpost[];
};

// Minimal-edit operations applied to the remaining (not-yet-completed) goalposts.
export type PathAdjustment = {
  insertedGoalposts: GoalpostPlan[]; // new goalposts (order = insertion point)
  removedOrders: number[]; // orders of remaining goalposts to drop
  modifiedGoalposts: Array<{
    order: number;
    title?: string;
    objective?: string;
    estimatedMinutes?: number;
  }>;
  rationale: string; // user-facing one-liner (L0.md §7 Q7 acknowledge notice)
};

export interface PathAdjuster {
  adjust(input: PathAdjusterInput): Promise<PathAdjustment>;
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
  pathAdjuster: PathAdjuster;
  mode: "mock" | "live";
};
