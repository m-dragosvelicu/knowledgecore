import { z } from "zod";
import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd, getLlmTelemetryContext } from "@/lib/llm";
import { prisma } from "@/lib/db";
import type {
  PathConfirmationInput,
  PathConfirmationStep,
} from "@/lib/services/pathConfirmation";
import type { PathConfirmationInterviewer } from "@/lib/services/interfaces/pathConfirmationInterviewer.interface";
import { PATH_CONFIRMATION_INTERVIEWER_SYSTEM } from "@/lib/llm/prompts/pathConfirmationInterviewerPrompts";

// gemini-3.5-flash is the live default for L0/L1 services. Fallback model id for
// telemetry when a failure short-circuits the call before usage fires.
const TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

// Hard cap on assistant clarifying questions: this dialogue sits in front of
// goalpost 1 and must synthesize a concern rather than ask again once hit.
// The user-facing soft cap on correction rounds lives in the UI; this is the
// per-round cap on questions, mirroring GeminiGoalInterviewer.MAX_QUESTIONS.
const MAX_QUESTIONS = 2;

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

export class GeminiPathConfirmationInterviewer
  implements PathConfirmationInterviewer
{
  constructor(private readonly llm: LLMClient) {}

  /**
   * Best-effort per-turn telemetry, mirroring GeminiGoalInterviewer. Logged
   * under `goal_interview` — same dialogue engine in a new context; no
   * dedicated purpose enum exists yet for confirmation dialogues.
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
        system: PATH_CONFIRMATION_INTERVIEWER_SYSTEM,
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
