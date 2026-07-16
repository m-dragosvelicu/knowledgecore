import type {
  CanDoStatement,
  ParsedSubject,
  ProbeAnswer,
  ProbeQuestion,
  ProbeScoreResult,
} from "@/lib/services/types";

export interface KnowledgeProbe {
  questions(subject: ParsedSubject, outcome: CanDoStatement[]): Promise<ProbeQuestion[]>;
  // Stateless scoring: the answered questions are passed in explicitly so scoring
  // never depends on instance state surviving between requests (the root cause of
  // the "all competencies 0/4" bug — a fresh service instance per request lost the
  // questions and the action regenerated mismatched ones).
  score(questions: ProbeQuestion[], answers: ProbeAnswer[]): Promise<ProbeScoreResult>;
}
