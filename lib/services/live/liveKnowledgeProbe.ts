import type { LLMClient } from "@/lib/llm";
import type {
  CanDoStatement,
  KnowledgeProbe,
  ParsedSubject,
  ProbeAnswer,
  ProbeQuestion,
  ProbeScoreResult,
  ProbeTranscriptEntry,
} from "@/lib/services/types";
import { competenciesResultSchema, probeQuestionsResultSchema } from "./schemas";

const QUESTIONS_SYSTEM = `You are the diagnostic step of an AI learning platform.
Generate 6 to 8 short probe questions that reveal what the learner already knows
about the subject and its prerequisites, so the system can place them correctly.
Lean toward 8 when the subject is broad or has many prerequisites; 6 is the floor.

Rules:
- Mix "open" questions (short free-text) and "multiple_choice" questions.
- For every multiple_choice question, include 3 to 4 options AND always include a
  graceful "I'm not sure" style option so a beginner is never forced to guess.
- Probe prerequisites and adjacent skills, not just the headline topic.
- Give each question a short stable id (e.g. "q1") and a competencyTag (a short
  kebab-case label naming the skill the question measures).`;

const SCORE_SYSTEM = `You are the diagnostic-scoring step of an AI learning
platform. You receive the exact probe questions the learner was asked, each
paired with the learner's verbatim answer. Score against THESE questions and
answers only — never invent or assume questions that are not shown.

Produce two things:

1. competencies — one entry per distinct skill you can assess from the answers.
   - estimatedLevel is an integer 0 (none) to 4 (strong).
   - confidence is 0 to 1: how much the answers actually justify the estimate.
   Calibration (apply strictly, do NOT default to 0):
   - A correct, clearly-articulated answer earns estimatedLevel 3 or 4.
   - A partially-correct answer, or one showing real but incomplete understanding,
     earns estimatedLevel 1 or 2.
   - "I'm not sure", blank, or an explicit "I don't know" earns a LOW level (0 or
     1) with HIGH confidence (>= 0.8) — not knowing is a confident signal.
   - A short but on-target answer is not penalized for brevity; only vague or
     evasive answers lower confidence.
   - Use the question's competencyTag as the competency name where it fits;
     otherwise use a clear kebab-case skill label.

2. judgements — exactly one entry per question shown, keyed by its questionId,
   with a single-sentence judgement of what that learner's answer revealed about
   their knowledge (e.g. "Correctly solved the linear equation, showing solid
   algebra fluency." or "Selected 'I'm not sure', so no eigenvalue intuition yet.").`;

export class LiveKnowledgeProbe implements KnowledgeProbe {
  constructor(private readonly llm: LLMClient) {}

  async questions(
    subject: ParsedSubject,
    outcome: CanDoStatement[],
  ): Promise<ProbeQuestion[]> {
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
    // Normalize to the ProbeQuestion shape (options: string[] | undefined).
    return result.questions.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      kind: q.kind,
      competencyTag: q.competencyTag,
      options: q.options ?? undefined,
    }));
  }

  // Stateless: the answered questions are passed in explicitly, so scoring never
  // depends on instance state surviving between requests. Each answer is paired
  // to its question by id; the model scores against the actual shown Q/A pairs.
  async score(
    questions: ProbeQuestion[],
    answers: ProbeAnswer[],
  ): Promise<ProbeScoreResult> {
    const answerLookup = new Map(answers.map((a) => [a.questionId, a.response]));

    // Build annotated context from the PASSED-IN questions, pairing each with the
    // learner's answer (or an explicit "(no answer)" marker so the model can score
    // an unanswered question as a confident low signal).
    const annotated = questions.map((q) => {
      const response = answerLookup.get(q.id);
      const answerText =
        response && response.trim().length > 0 ? response : "(no answer)";
      const optionsLine =
        q.options && q.options.length > 0
          ? `\nOptions: ${q.options.join(" | ")}`
          : "";
      return [
        `Question id: ${q.id}`,
        `Competency tag: ${q.competencyTag}`,
        `Q (${q.kind}): ${q.prompt}${optionsLine}`,
        `A: ${answerText}`,
      ].join("\n");
    });

    const result = await this.llm.completeStructured({
      system: SCORE_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            `Probe questions the learner was asked, paired with their answers:`,
            ``,
            annotated.join("\n\n"),
            ``,
            `Produce the competency profile and one judgement per question id above.`,
          ].join("\n"),
        },
      ],
      temperature: 0.3,
      schema: competenciesResultSchema,
      schemaName: "Competencies",
    });

    // Assemble the transcript in code from the authoritative questions/answers,
    // attaching the model's per-question judgement. We iterate over the actual
    // questions so the transcript reflects exactly what the learner saw, even if
    // the model omits or duplicates a judgement.
    const judgementLookup = new Map(
      result.judgements.map((j) => [j.questionId, j.judgement]),
    );
    const transcript: ProbeTranscriptEntry[] = questions.map((q) => {
      const response = answerLookup.get(q.id);
      const answerText =
        response && response.trim().length > 0 ? response : "(no answer)";
      return {
        question: q.prompt,
        answer: answerText,
        judgement:
          judgementLookup.get(q.id) ?? "No judgement returned for this answer.",
      };
    });

    return { competencies: result.competencies, transcript };
  }
}
