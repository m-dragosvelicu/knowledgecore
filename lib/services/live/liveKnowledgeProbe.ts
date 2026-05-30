import type { LLMClient } from "@/lib/llm";
import type {
  CanDoStatement,
  Competency,
  KnowledgeProbe,
  ParsedSubject,
  ProbeAnswer,
  ProbeQuestion,
} from "@/lib/services/types";
import { competenciesResultSchema, probeQuestionsResultSchema } from "./schemas";

const QUESTIONS_SYSTEM = `You are the diagnostic step of an AI learning platform.
Generate 5 to 6 short probe questions that reveal what the learner already knows
about the subject and its prerequisites, so the system can place them correctly.

Rules:
- Mix "open" questions (short free-text) and "multiple_choice" questions.
- For every multiple_choice question, include 3 to 4 options AND always include a
  graceful "I'm not sure" style option so a beginner is never forced to guess.
- Probe prerequisites and adjacent skills, not just the headline topic.
- Give each question a short stable id (e.g. "q1") and a competencyTag (a short
  kebab-case label naming the skill the question measures).`;

const SCORE_SYSTEM = `You are the diagnostic-scoring step of an AI learning
platform. You receive the learner's answers to probe questions. Infer their
competency profile.

Rules:
- Output one competency entry per distinct skill you can assess from the answers.
- estimatedLevel is 0 (none) to 4 (strong).
- confidence is 0 to 1, reflecting how much the answers actually justify your
  estimate. Short or evasive answers => lower confidence.
- Use the competencyTag from the answers where available; otherwise use a clear
  kebab-case skill label.`;

export class LiveKnowledgeProbe implements KnowledgeProbe {
  private lastSubject: ParsedSubject | null = null;
  private lastQuestions: ProbeQuestion[] = [];

  constructor(private readonly llm: LLMClient) {}

  async questions(
    subject: ParsedSubject,
    outcome: CanDoStatement[],
  ): Promise<ProbeQuestion[]> {
    this.lastSubject = subject;
    const result = await this.llm.completeStructured({
      system: QUESTIONS_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            `Subject: ${subject.canonicalName}`,
            `Scope: ${subject.scopeNote}`,
            `Target outcomes the learner wants to reach:`,
            ...outcome.map((o) => `- (${o.bloomLevel}) ${o.text}`),
            ``,
            `Generate the probe questions.`,
          ].join("\n"),
        },
      ],
      temperature: 0.4,
      schema: probeQuestionsResultSchema,
      schemaName: "ProbeQuestions",
    });
    this.lastQuestions = result.questions;
    return result.questions;
  }

  async score(answers: ProbeAnswer[]): Promise<Competency[]> {
    const questionLookup = new Map(
      this.lastQuestions.map((q) => [q.id, q]),
    );
    const annotated = answers.map((a) => {
      const q = questionLookup.get(a.questionId);
      return q
        ? `Q (${q.competencyTag}): ${q.prompt}\nA: ${a.response}`
        : `Q [${a.questionId}]: ${a.response}`;
    });
    const result = await this.llm.completeStructured({
      system: SCORE_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            this.lastSubject
              ? `Subject: ${this.lastSubject.canonicalName}`
              : `Subject: (unknown)`,
            ``,
            `Learner's answers:`,
            ...annotated,
            ``,
            `Produce the competency profile.`,
          ].join("\n"),
        },
      ],
      temperature: 0.3,
      schema: competenciesResultSchema,
      schemaName: "Competencies",
    });
    return result.competencies;
  }
}
