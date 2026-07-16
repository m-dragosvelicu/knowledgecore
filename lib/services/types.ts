import type { Decision, Motivation, StepType } from "@prisma/client";
import type { IntentParser } from "@/lib/services/interfaces/intentParser.interface";
import type { GoalInterviewer } from "@/lib/services/interfaces/goalInterviewer.interface";
import type { KnowledgeProbe } from "@/lib/services/interfaces/knowledgeProbe.interface";
import type { PathOutliner } from "@/lib/services/interfaces/pathOutliner.interface";
import type { CheckpointEvaluator } from "@/lib/services/interfaces/checkpointEvaluator.interface";
import type { PathAdjuster } from "@/lib/services/interfaces/pathAdjuster.interface";

export type ParsedSubject = {
  canonicalName: string;
  scopeNote: string;
  // Surfaces ambiguity back to the learner instead of silently narrowing
  // (L0.md §3 Stage 2). Transient — not persisted; drives the confirm/refine
  // step in the intent wizard.
  ambiguous?: boolean;
  // A short clarification question/note shown to the learner when `ambiguous`.
  clarification?: string;
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
// Data types feeding the service interfaces (see lib/services/interfaces/)
// =====================================================================

// One turn of the multi-turn goal interview. The client (outcome page) holds the
// running transcript and re-sends it each turn so the interviewer stays stateless.
export type InterviewTurn = {
  role: "assistant" | "user";
  content: string;
};

// The result of one interview turn: either the next focused question to ask, or
// a terminal "complete" step carrying the synthesized outcome.
export type InterviewStep =
  | { kind: "question"; question: string }
  | {
      kind: "complete";
      canDoStatements: CanDoStatement[];
      successCriterion: string;
    };

export type GoalInterviewInput = {
  subject: ParsedSubject;
  motivation: Motivation;
  transcript: InterviewTurn[];
};

export type ProbeScoreResult = {
  competencies: Competency[];
  transcript: ProbeTranscriptEntry[];
};

export type PathOutlinerInput = {
  subject: ParsedSubject;
  motivation: Motivation;
  outcome: CanDoStatement[];
  assessment: Competency[];
};

export type EvaluatorInput = {
  goalpostTitle: string;
  goalpostObjective: string;
  informationContent: string;
  experiencePrompt: string;
  userArtifact: string;
  attempt: number;
};

// Path Adjuster — L0.md §5/§7 decision branch `adjust_plan`. Added to the
// locked boundary under CEO delegated authority (2026-05-31) to close the M6
// remediation loop (see DECISIONS-INDEX). Minimal-edit principle: prefer
// inserting/replacing 1-2 goalposts over rewriting the tail; keep >=70% of
// the original remaining path intact.

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

// =====================================================================
// Service registry — the typed contract bundle getServices() builds
// =====================================================================

export type Services = {
  intentParser: IntentParser;
  goalInterviewer: GoalInterviewer;
  knowledgeProbe: KnowledgeProbe;
  pathOutliner: PathOutliner;
  checkpointEvaluator: CheckpointEvaluator;
  pathAdjuster: PathAdjuster;
};
