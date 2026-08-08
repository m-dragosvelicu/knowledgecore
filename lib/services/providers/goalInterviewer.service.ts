import { z } from "zod";
import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd, getLlmTelemetryContext } from "@/lib/llm";
import { prisma } from "@/lib/db";
import type {
  CanDoStatement,
  GoalInterviewInput,
  InterviewStep,
} from "@/lib/services/types";
import type { GoalInterviewer } from "@/lib/services/interfaces/goalInterviewer.interface";
import { canDoStatementSchema } from "./shared.schemas";
import { GOAL_INTERVIEWER_SYSTEM } from "@/lib/llm/prompts/goalInterviewerPrompts";

// Not currently sent as a standalone structured-output schema (interviewStepSchema
// carries canDoStatements inline); kept for parity with the schema family this
// provider owns.
export const goalInterviewResultSchema = z.object({
  canDoStatements: z.array(canDoStatementSchema).min(1),
});

// Flat object (not a discriminated union): the Gemini converter has no oneOf/anyOf,
// so the optional fields are normalized in this file by `kind`.
const interviewStepSchema = z.object({
  kind: z.enum(["question", "complete"]),
  question: z.string().nullish(),
  canDoStatements: z.array(canDoStatementSchema).nullish(),
  successCriterion: z.string().nullish(),
});

// gemini-3.5-flash is the live default for L0 services. Fallback model id for
// telemetry when a failure short-circuits the call before usage fires.
const TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

// Hard cap on assistant questions (L0.md §5: 3-6 turns). Once the transcript
// already holds this many assistant questions, the model MUST synthesize a
// complete step from whatever it has rather than asking a further question.
const MAX_QUESTIONS = 5;

type TelemetrySnapshot = {
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  usage?: CompletionResult["usage"];
  model?: string;
};

/** Gemini-backed GoalInterviewer: multi-turn structured dialogue. */
export class GeminiGoalInterviewer implements GoalInterviewer {
  constructor(private readonly llm: LLMClient) {}

  /**
   * Best-effort per-turn telemetry. Mirrors GeminiCheckpointEvaluator: never let a
   * logging failure break the interview.
   */
  private async recordLlmCall(snapshot: TelemetrySnapshot): Promise<void> {
    try {
      const model = snapshot.model ?? TELEMETRY_MODEL;
      const inputTokens = snapshot.usage?.inputTokens ?? 0;
      const outputTokens = snapshot.usage?.outputTokens ?? 0;
      const ctx = getLlmTelemetryContext();
      await prisma.llmCall.create({
        data: {
          purpose: "goal_interview",
          model,
          inputTokens,
          outputTokens,
          costMicroUsd: computeCostMicroUsd(model, inputTokens, outputTokens),
          latencyMs: snapshot.latencyMs,
          success: snapshot.success,
          errorMessage: snapshot.errorMessage,
          evaluationId: null,
          userId: ctx?.userId ?? null,
          intentId: ctx?.intentId ?? null,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[llm-telemetry] failed to persist goal_interview row: ${
          (err as Error).message
        }`,
      );
    }
  }

  private buildMessages(input: GoalInterviewInput, forceComplete: boolean) {
    const header = [
      `Subject: ${input.subject.canonicalName}`,
      `Scope: ${input.subject.scopeNote}`,
      `Motivation (given): ${input.motivation}`,
      ``,
      `--- Interview transcript so far ---`,
    ];
    const body =
      input.transcript.length === 0
        ? ["(no turns yet — this is the first question)"]
        : input.transcript.map(
            (t) => `${t.role === "assistant" ? "You" : "Learner"}: ${t.content}`,
          );

    const instruction = forceComplete
      ? [
          ``,
          `You have already asked the maximum number of questions. You MUST return`,
          `kind="complete" now. Synthesize a time-horizon assumption if needed and`,
          `write 3 or 4 concrete can-do statements plus a one-sentence`,
          `successCriterion from everything the learner has told you.`,
        ]
      : [
          ``,
          `Decide the next step: return kind="question" with ONE question, or`,
          `kind="complete" if you already have a time horizon and can write >=3`,
          `concrete can-do statements.`,
        ];

    return [
      {
        role: "user" as const,
        content: [...header, ...body, ...instruction].join("\n"),
      },
    ];
  }

  async interview(input: GoalInterviewInput): Promise<InterviewStep> {
    const assistantQuestions = input.transcript.filter(
      (t) => t.role === "assistant",
    ).length;
    const forceComplete = assistantQuestions >= MAX_QUESTIONS;

    const startedAt = Date.now();
    let usage: CompletionResult["usage"] | undefined;
    let usageModel: string | undefined;
    let raw: {
      kind: "question" | "complete";
      question?: string | null;
      canDoStatements?: CanDoStatement[] | null;
      successCriterion?: string | null;
    };
    try {
      raw = await this.llm.completeStructured({
        system: GOAL_INTERVIEWER_SYSTEM,
        messages: this.buildMessages(input, forceComplete),
        temperature: 0.5,
        maxTokens: 1024,
        schema: interviewStepSchema,
        schemaName: "InterviewStep",
        onUsage: (u, m) => {
          usage = u;
          usageModel = m;
        },
      });
    } catch (err) {
      await this.recordLlmCall({
        latencyMs: Date.now() - startedAt,
        success: false,
        errorMessage: (err as Error).message,
        usage,
        model: usageModel,
      });
      throw err;
    }
    await this.recordLlmCall({
      latencyMs: Date.now() - startedAt,
      success: true,
      errorMessage: null,
      usage,
      model: usageModel,
    });

    return this.normalize(raw, forceComplete);
  }

  /**
   * Reconcile the flat schema object into a sound InterviewStep. Guards against
   * the model emitting kind="complete" without enough statements, and honors the
   * forceComplete cap (we never emit a further question past the cap).
   */
  private normalize(
    raw: {
      kind: "question" | "complete";
      question?: string | null;
      canDoStatements?: CanDoStatement[] | null;
      successCriterion?: string | null;
    },
    forceComplete: boolean,
  ): InterviewStep {
    const statements = raw.canDoStatements ?? [];
    const hasEnough = statements.length >= 3;

    // Honor completion when the model says complete (and has the goods) OR when
    // the cap forced completion and we got usable statements back.
    if ((raw.kind === "complete" || forceComplete) && hasEnough) {
      return {
        kind: "complete",
        canDoStatements: statements,
        successCriterion:
          (raw.successCriterion ?? "").trim() ||
          "You can demonstrate the capabilities listed above.",
      };
    }

    // The model wanted a question (or completed without enough statements). If we
    // are past the cap we cannot ask again, so degrade to whatever statements we
    // have, backfilling to a safe minimum so the journey never stalls.
    if (forceComplete) {
      const filled =
        statements.length > 0
          ? statements
          : ([
              {
                text: "I can explain the core ideas of this subject in my own words.",
                bloomLevel: "understand",
              },
              {
                text: "I can apply the main techniques to a concrete problem.",
                bloomLevel: "apply",
              },
              {
                text: "I can judge when and where to use what I have learned.",
                bloomLevel: "evaluate",
              },
            ] as CanDoStatement[]);
      return {
        kind: "complete",
        canDoStatements: filled,
        successCriterion:
          (raw.successCriterion ?? "").trim() ||
          "You can demonstrate the capabilities listed above.",
      };
    }

    const question =
      (raw.question ?? "").trim() ||
      "What would success look like for you with this subject, and by when?";
    return { kind: "question", question };
  }
}
