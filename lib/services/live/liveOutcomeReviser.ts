import { z } from "zod";
import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd } from "@/lib/llm";
import { prisma } from "@/lib/db";
import type {
  OutcomeReviser,
  OutcomeRevisionInput,
  OutcomeRevisionResult,
} from "@/lib/services/outcomeRevision";
import { canDoStatementSchema } from "./schemas";

// gemini-3.5-flash is the live default for L0/L1 generative services. Fallback
// model id for telemetry when a failure short-circuits before onUsage fires.
const TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

const SYSTEM = `You are the outcome-revision step of an AI learning platform. A
learner was shown a synthesized outcome for their learning journey — a subject,
a scope note, a one-sentence success criterion, and a list of "I can..." can-do
statements — and told you what is off about it in their own words.

Your job is to REVISE the outcome, not regenerate it. Read the current outcome
and the learner's feedback, then:
- Change ONLY what the feedback calls out. Anything the feedback does not
  object to must be preserved verbatim (same wording, same statements, same
  bloomLevel tags) unless a change to one part logically forces a change
  elsewhere (e.g. narrowing the subject may require rewording a can-do statement
  that no longer fits).
- If the feedback targets the SUBJECT (wrong topic, wrong slice of a field),
  revise canonicalName and/or scopeNote accordingly, then reconcile the
  can-do statements and success criterion so they still describe THIS subject.
- If the feedback targets the OUTCOME itself (wrong level, wrong emphasis,
  missing capability, something to drop), revise successCriterion and/or
  canDoStatements accordingly, leaving the subject untouched.
- Keep the SAME NUMBER of can-do statements and the SAME spread of Bloom
  levels as the current outcome UNLESS the feedback explicitly asks to add,
  remove, or fundamentally re-scope one.
- scopeNote must stay an HONEST, introductory-level scope estimate (mirror the
  existing phrasing style, e.g. "Estimated scope: introductory, focused on
  practical application") — never inflate it into an expert-level promise the
  rest of the platform cannot back up.
- Each can-do statement's "text" must start with "I can" and be an observable,
  assessable capability in SENTENCE CASE (capitalize only the first word and
  genuine proper nouns) — mirror the current statements' voice.
- Tag each can-do statement with the closest Bloom level: remember, understand,
  apply, analyze, evaluate, or create.

Output contract (always a single JSON object):
- "canonicalName", "scopeNote", "canDoStatements", "successCriterion": the
  revised outcome, following the rules above.
- "acknowledgment": ONE short, warm sentence in the SECOND PERSON, spoken
  directly to the learner as "you", confirming what you changed (e.g. "Got it —
  I've shifted this toward the ethics side and dropped the coding-heavy
  statement."). Never say "the learner"; never narrate in the third person.`;

const outcomeRevisionSchema = z.object({
  canonicalName: z.string().min(1),
  scopeNote: z.string().min(1),
  canDoStatements: z.array(canDoStatementSchema).min(1),
  successCriterion: z.string().min(1),
  acknowledgment: z.string().min(1),
});

type TelemetrySnapshot = {
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  usage?: CompletionResult["usage"];
  model?: string;
};

export class LiveOutcomeReviser implements OutcomeReviser {
  constructor(private readonly llm: LLMClient) {}

  // Best-effort telemetry; mirrors the other live services. Never breaks the
  // revision on a logging failure.
  private async recordLlmCall(snapshot: TelemetrySnapshot): Promise<void> {
    try {
      const model = snapshot.model ?? TELEMETRY_MODEL;
      const inputTokens = snapshot.usage?.inputTokens ?? 0;
      const outputTokens = snapshot.usage?.outputTokens ?? 0;
      await prisma.llmCall.create({
        data: {
          purpose: "outcome_revision",
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
        `[llm-telemetry] failed to persist outcome_revision row: ${
          (err as Error).message
        }`,
      );
    }
  }

  private buildMessages(input: OutcomeRevisionInput) {
    const content = [
      `--- Current outcome ---`,
      `Subject: ${input.subject.canonicalName}`,
      `Scope: ${input.subject.scopeNote}`,
      `Success criterion: ${input.successCriterion}`,
      `Can-do statements:`,
      ...input.canDoStatements.map((s) => `- (${s.bloomLevel}) ${s.text}`),
      ``,
      `--- Learner's feedback ---`,
      input.feedback,
      ``,
      `Revise the outcome per the rules above.`,
    ].join("\n");
    return [{ role: "user" as const, content }];
  }

  async revise(input: OutcomeRevisionInput): Promise<OutcomeRevisionResult> {
    const startedAt = Date.now();
    let usage: CompletionResult["usage"] | undefined;
    let usageModel: string | undefined;
    let raw: z.infer<typeof outcomeRevisionSchema>;
    try {
      raw = await this.llm.completeStructured({
        system: SYSTEM,
        messages: this.buildMessages(input),
        temperature: 0.4,
        maxTokens: 1024,
        schema: outcomeRevisionSchema,
        schemaName: "OutcomeRevision",
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

    return {
      subject: {
        canonicalName: raw.canonicalName,
        scopeNote: raw.scopeNote,
      },
      canDoStatements: raw.canDoStatements,
      successCriterion: raw.successCriterion,
      acknowledgment: raw.acknowledgment,
    };
  }
}
