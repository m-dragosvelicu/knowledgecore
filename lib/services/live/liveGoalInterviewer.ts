import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd } from "@/lib/llm";
import { prisma } from "@/lib/db";
import type {
  CanDoStatement,
  GoalInterviewer,
  GoalInterviewInput,
  InterviewStep,
} from "@/lib/services/types";
import { interviewStepSchema } from "./schemas";

// gemini-3.5-flash is the live default for L0 services. Fallback model id for
// telemetry when a failure short-circuits the call before usage fires.
const TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

// Hard cap on assistant questions (L0.md §5: 3-6 turns). Once the transcript
// already holds this many assistant questions, the model MUST synthesize a
// complete step from whatever it has rather than asking a further question.
const MAX_QUESTIONS = 5;

const SYSTEM = `You are the goal-setting interviewer of an AI learning platform.
You are interviewing the learner to understand WHY they want to learn the subject
and WHAT success looks like for them, so the rest of the system can tailor a path.

You already know the subject and the learner's broad motivation (given below).
Conduct a SHORT, focused interview. On each turn you either ask ONE question or
declare the interview complete.

What you must collect before completing:
- A TIME HORIZON (when do they want to be able to do this by — a deadline, "a few
  weeks", "no rush", etc.).
- Any EXTERNAL CONSTRAINTS that shape the path (an exam, a project deadline,
  prerequisites they want to skip), IF they are relevant — do not force this.
- Enough understanding to articulate at least THREE concrete, observable "I can..."
  can-do statements that define success for THIS learner.

How to behave each turn:
- Ask ONE focused question at a time. Build on the learner's previous answers in
  the transcript; never repeat a question they already answered.
- Keep questions short, plain, and warm. No jargon, no lists of sub-questions.
- When you have a time horizon AND can confidently write >=3 concrete can-do
  statements, return kind="complete". Otherwise return kind="question".

Output contract (always a single JSON object):
- kind="question": set "question" to the next question. Leave the other fields null.
- kind="complete": set "canDoStatements" to 3 or 4 statements and "successCriterion"
  to ONE sentence summarizing what success looks like. Leave "question" null.

Can-do statement rules (only for kind="complete"):
- Each "text" must start with "I can" and describe an observable, assessable
  capability, not a vague feeling.
- Write each statement in SENTENCE CASE: capitalize only the first word and
  genuine proper nouns (names of people, places, named theories/movements,
  languages, branded technologies — e.g. "Art Nouveau", "French", "Python").
  Do NOT Title-Case Every Word; ordinary technical terms stay lowercase
  mid-sentence (e.g. "default mode network", "balance sheet").
- Tailor difficulty and framing to the motivation and what the learner told you
  (work -> applied/practical; curiosity -> conceptual; school -> exam-style).
- Tag each with the closest Bloom level: remember, understand, apply, analyze,
  evaluate, or create.
- Order them roughly from foundational to ambitious.`;

type TelemetrySnapshot = {
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  usage?: CompletionResult["usage"];
  model?: string;
};

export class LiveGoalInterviewer implements GoalInterviewer {
  constructor(private readonly llm: LLMClient) {}

  /**
   * Best-effort per-turn telemetry. Mirrors LiveCheckpointEvaluator: never let a
   * logging failure break the interview.
   */
  private async recordLlmCall(snapshot: TelemetrySnapshot): Promise<void> {
    try {
      const model = snapshot.model ?? TELEMETRY_MODEL;
      const inputTokens = snapshot.usage?.inputTokens ?? 0;
      const outputTokens = snapshot.usage?.outputTokens ?? 0;
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
        system: SYSTEM,
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
