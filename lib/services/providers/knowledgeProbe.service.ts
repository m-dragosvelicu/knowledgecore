import { z } from "zod";
import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd } from "@/lib/llm";
import { prisma } from "@/lib/db";
import type {
  CanDoStatement,
  ParsedSubject,
  ProbeAnswer,
  ProbeQuestion,
  ProbeScoreResult,
  ProbeTranscriptEntry,
} from "@/lib/services/types";
import type { KnowledgeProbe } from "@/lib/services/interfaces/knowledgeProbe.interface";
import { rubricLevelSchema } from "./shared.schemas";
import {
  KNOWLEDGE_PROBE_QUESTIONS_SYSTEM,
  KNOWLEDGE_PROBE_SCORE_SYSTEM,
} from "@/lib/llm/prompts/knowledgeProbePrompts";

const probeQuestionSchema = z
  .object({
    id: z.string().min(1),
    prompt: z.string().min(1),
    kind: z.enum(["open", "multiple_choice"]),
    // Gemini emits options even for open questions (null); normalized to undefined below.
    options: z.array(z.string()).nullish(),
    competencyTag: z.string().min(1),
  })
  .transform((q) => ({
    ...q,
    options: q.options ?? undefined,
  }));

const probeQuestionsResultSchema = z.object({
  questions: z.array(probeQuestionSchema).min(1),
});

const competencySchema = z.object({
  competency: z.string().min(1),
  estimatedLevel: rubricLevelSchema,
  confidence: z.number().min(0).max(1),
});

// One-sentence judgement keyed back to the probe question by id; assembled in code
// into ProbeTranscriptEntry rows with the passed-in prompt/answer.
const probeJudgementSchema = z.object({
  questionId: z.string().min(1),
  judgement: z.string().min(1),
});

const competenciesResultSchema = z.object({
  competencies: z.array(competencySchema).min(1),
  judgements: z.array(probeJudgementSchema),
});

// gemini-3.5-flash is the live default. Token usage is surfaced from
// completeStructured via the onUsage callback (lib/llm/types.ts); this
// constant is only the telemetry fallback for a pre-usage failure.
const TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

type ProbePurpose = "knowledge_probe_questions" | "knowledge_probe_score";

type TelemetrySnapshot = {
  purpose: ProbePurpose;
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  // Real token usage captured from the LLM client's onUsage callback. Absent
  // only when the call failed before the provider returned usage metadata.
  usage?: CompletionResult["usage"];
  // Provider-reported model id from the same callback; falls back to
  // TELEMETRY_MODEL when usage never fired.
  model?: string;
};

/** Gemini-backed KnowledgeProbe: question generation + answer scoring. */
export class GeminiKnowledgeProbe implements KnowledgeProbe {
  constructor(private readonly llm: LLMClient) {}

  /**
   * Best-effort per-call telemetry. Wrapped in try/catch so a logging failure
   * can never break probe question generation or scoring.
   */
  private async recordLlmCall(snapshot: TelemetrySnapshot): Promise<void> {
    try {
      const model = snapshot.model ?? TELEMETRY_MODEL;
      const inputTokens = snapshot.usage?.inputTokens ?? 0;
      const outputTokens = snapshot.usage?.outputTokens ?? 0;
      await prisma.llmCall.create({
        data: {
          purpose: snapshot.purpose,
          model,
          inputTokens,
          outputTokens,
          // 0 only when the model is absent from the pricing table; tokens stay real.
          costMicroUsd: computeCostMicroUsd(model, inputTokens, outputTokens),
          latencyMs: snapshot.latencyMs,
          success: snapshot.success,
          errorMessage: snapshot.errorMessage,
          evaluationId: null,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[llm-telemetry] failed to persist ${snapshot.purpose} row: ${
          (err as Error).message
        }`,
      );
    }
  }

  async questions(
    subject: ParsedSubject,
    outcome: CanDoStatement[],
  ): Promise<ProbeQuestion[]> {
    const startedAt = Date.now();
    let usage: CompletionResult["usage"] | undefined;
    let usageModel: string | undefined;
    let result: z.input<typeof probeQuestionsResultSchema>;
    try {
      result = await this.llm.completeStructured({
        system: KNOWLEDGE_PROBE_QUESTIONS_SYSTEM,
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
        onUsage: (u, m) => {
          usage = u;
          usageModel = m;
        },
      });
    } catch (err) {
      await this.recordLlmCall({
        purpose: "knowledge_probe_questions",
        latencyMs: Date.now() - startedAt,
        success: false,
        errorMessage: (err as Error).message,
        usage,
        model: usageModel,
      });
      throw err;
    }
    await this.recordLlmCall({
      purpose: "knowledge_probe_questions",
      latencyMs: Date.now() - startedAt,
      success: true,
      errorMessage: null,
      usage,
      model: usageModel,
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

    const startedAt = Date.now();
    let usage: CompletionResult["usage"] | undefined;
    let usageModel: string | undefined;
    let result: z.input<typeof competenciesResultSchema>;
    try {
      result = await this.llm.completeStructured({
        system: KNOWLEDGE_PROBE_SCORE_SYSTEM,
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
        onUsage: (u, m) => {
          usage = u;
          usageModel = m;
        },
      });
    } catch (err) {
      await this.recordLlmCall({
        purpose: "knowledge_probe_score",
        latencyMs: Date.now() - startedAt,
        success: false,
        errorMessage: (err as Error).message,
        usage,
        model: usageModel,
      });
      throw err;
    }
    await this.recordLlmCall({
      purpose: "knowledge_probe_score",
      latencyMs: Date.now() - startedAt,
      success: true,
      errorMessage: null,
      usage,
      model: usageModel,
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
