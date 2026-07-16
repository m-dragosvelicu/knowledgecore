import { z } from "zod";
import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd } from "@/lib/llm";
import { prisma } from "@/lib/db";
import type {
  PathConfirmationInput,
  PathConfirmationInterviewer,
  PathConfirmationStep,
} from "@/lib/services/pathConfirmation";

// gemini-3.5-flash is the live default for L0/L1 services. Fallback model id for
// telemetry when a failure short-circuits the call before usage fires.
const TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

// Hard cap on assistant clarifying questions: this dialogue sits in front of
// goalpost 1 and must synthesize a concern rather than ask again once hit.
// The user-facing soft cap on correction rounds lives in the UI; this is the
// per-round cap on questions, mirroring LiveGoalInterviewer.MAX_QUESTIONS.
const MAX_QUESTIONS = 2;

const SYSTEM = `You are the PATH CONFIRMATION interviewer of an AI learning
platform. The learner has just been shown a proposed, STRUCTURE-ONLY path
overview (goalpost titles, objectives, and the end "you'll be able to..."
achievement) and said it is "not quite right". Your job is a SHORT, focused
clarifying conversation to pin down WHAT is off, so the system can revise the
plan before they start.

On each turn you either ask ONE clarifying question or declare the conversation
complete.

What you are trying to understand:
- Is the path aimed at the WRONG LEVEL (too advanced / too basic)?
- Is it MISSING something the learner needs?
- Does it COVER things the learner already knows and wants to skip?
- Is the SCOPE or emphasis wrong relative to why they are learning this?

How to behave each turn:
- Ask ONE focused question at a time. Build on the learner's previous answers in
  the transcript; never repeat a question they already answered.
- Keep questions short, plain, and warm. No jargon, no lists of sub-questions.
- As soon as you can describe the concern concretely enough to act on, return
  kind="complete". Do not drag the conversation out — one or two questions is
  usually enough.

Output contract (always a single JSON object):
- kind="question": set "question" to the next clarifying question. Leave
  "concern" null.
- kind="complete": set "concern" to a CONCISE summary, in the learner's own
  terms, of what is off and how the plan should change. This text is handed
  straight to the path adjuster, so make it specific and actionable (e.g. "Drop
  the introductory matrix goalposts — the learner already knows them — and add a
  goalpost on eigendecomposition for PCA"). Leave "question" null.`;

// Flat object (not a discriminated union) for reliable Gemini structured output,
// mirroring interviewStepSchema. Normalized in code based on `kind`.
const confirmationStepSchema = z.object({
  kind: z.enum(["question", "complete"]),
  question: z.string().nullish(),
  concern: z.string().nullish(),
});

type TelemetrySnapshot = {
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  usage?: CompletionResult["usage"];
  model?: string;
};

export class LivePathConfirmationInterviewer
  implements PathConfirmationInterviewer
{
  constructor(private readonly llm: LLMClient) {}

  /**
   * Best-effort per-turn telemetry, mirroring LiveGoalInterviewer. Logged
   * under `goal_interview` — same dialogue engine in a new context; no
   * dedicated purpose enum exists yet for confirmation dialogues.
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
        `[llm-telemetry] failed to persist path-confirmation row: ${
          (err as Error).message
        }`,
      );
    }
  }

  private buildMessages(input: PathConfirmationInput, forceComplete: boolean) {
    const header = [
      `Subject: ${input.subject.canonicalName}`,
      `Scope: ${input.subject.scopeNote}`,
      ``,
      `End achievement (what they'll be able to do):`,
      ...input.outcome.map((o) => `- (${o.bloomLevel}) ${o.text}`),
      ``,
      `--- Proposed path overview (structure only) ---`,
      ...(input.overview.length
        ? input.overview.map(
            (g) =>
              `${g.order}. ${g.title} — ${g.objective} (~${g.estimatedMinutes} min)`,
          )
        : ["(no goalposts)"]),
      ``,
      `--- Clarifying conversation so far ---`,
    ];
    const body =
      input.transcript.length === 0
        ? ["(no turns yet — this is the first clarifying question)"]
        : input.transcript.map(
            (t) => `${t.role === "assistant" ? "You" : "Learner"}: ${t.content}`,
          );

    const instruction = forceComplete
      ? [
          ``,
          `You have asked enough questions. You MUST return kind="complete" now.`,
          `Synthesize a concise, actionable "concern" from everything the learner`,
          `has told you so the path adjuster can revise the overview.`,
        ]
      : [
          ``,
          `Decide the next step: return kind="question" with ONE clarifying`,
          `question, or kind="complete" with a concrete "concern" if you already`,
          `understand what is off.`,
        ];

    return [
      {
        role: "user" as const,
        content: [...header, ...body, ...instruction].join("\n"),
      },
    ];
  }

  async clarify(input: PathConfirmationInput): Promise<PathConfirmationStep> {
    const assistantQuestions = input.transcript.filter(
      (t) => t.role === "assistant",
    ).length;
    const forceComplete = assistantQuestions >= MAX_QUESTIONS;

    const startedAt = Date.now();
    let usage: CompletionResult["usage"] | undefined;
    let usageModel: string | undefined;
    let raw: z.infer<typeof confirmationStepSchema>;
    try {
      raw = await this.llm.completeStructured({
        system: SYSTEM,
        messages: this.buildMessages(input, forceComplete),
        temperature: 0.4,
        maxTokens: 512,
        schema: confirmationStepSchema,
        schemaName: "PathConfirmationStep",
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
   * Reconcile the flat object into a sound step. Honors the question cap (never
   * ask again past it) and degrades to a safe concern if the model completed
   * without one.
   */
  private normalize(
    raw: z.infer<typeof confirmationStepSchema>,
    forceComplete: boolean,
  ): PathConfirmationStep {
    const concern = (raw.concern ?? "").trim();

    if (raw.kind === "complete" || forceComplete) {
      return {
        kind: "complete",
        concern:
          concern ||
          "The learner indicated the path is not quite right; make a conservative, minimal adjustment toward the stated outcomes.",
      };
    }

    const question =
      (raw.question ?? "").trim() ||
      "What feels off about this plan — the level, something missing, or something you already know?";
    return { kind: "question", question };
  }
}
