import type { CompletionResult, LLMClient } from "@/lib/llm";
import { computeCostMicroUsd } from "@/lib/llm";
import { prisma } from "@/lib/db";
import type {
  GoalpostPlan,
  PathOutliner,
  PathOutlinerInput,
} from "@/lib/services/types";
import type { z } from "zod";
import { pathResultSchema } from "./schemas";

type PathResult = z.infer<typeof pathResultSchema>;

// gemini-3.5-flash is the live default for L0 services. Token usage is now
// surfaced from completeStructured via the optional onUsage callback (see
// lib/llm/types.ts); this constant is the fallback model id for telemetry when a
// failure short-circuits the call before any usage callback fires.
const TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

// L0.md §9.1 granularity: hard bounds 20-120 min, target 30-90 min per goalpost.
// The model is unreliable about this, so we clamp in code after generation.
const MIN_MINUTES = 20;
const MAX_MINUTES = 120;
const TARGET_MIN_MINUTES = 30;
const TARGET_MAX_MINUTES = 90;

// A well-formed experience prompt cannot be a degenerate fragment. Anything
// shorter than this is treated as malformed (the line-of-questions bug).
const MIN_PROMPT_CHARS = 20;

// A competency whose estimatedLevel is at or below this is a GAP the path must
// cover (L0.md §5). Used by the non-fatal coverage check.
const GAP_LEVEL_THRESHOLD = 1;

const SYSTEM = `You are the curriculum-design step of an AI learning platform.
Design a short learning PATH of 3 goalposts that takes THIS learner from where
they are now (their assessed competencies) to their stated outcomes.

Each goalpost has exactly two steps:
1. An "information" step: a self-contained explainer the learner reads. Write it
   as rich markdown of roughly 250-500 words. Be concrete, use at least one
   worked micro-example, and connect the idea to the learner's motivation. This
   is the only place the learner receives information, so it must stand alone.
2. An "experience" step: a single active task that forces the learner to USE the
   idea from the information step. Choose the type:
   - experience_socratic: answer a probing conceptual question in their own words
   - experience_applied_problem: solve a concrete problem and show their work
   - experience_mini_project: build/produce a small artifact
   Give it a clear prompt and list which rubric dimensions it targets
   (rubricFocus) from: recall, application, conceptual, transfer, communication,
   coverage.

EXPERIENCE PROMPT QUALITY — CRITICAL. Each experience prompt is shown to the
learner on its own, with no extra framing. It MUST therefore be:
- SELF-CONTAINED: a complete, well-formed task or question that makes sense
  read in isolation. The learner must know exactly what to do from the prompt
  alone.
- NEVER A VERBATIM ECHO of the learner's own words, their stated subject, or
  their motivation. Do not parrot their intent back at them as the question
  (e.g. if they said "I want to learn Art Nouveau", do NOT ask "What do you
  want to learn about Art Nouveau?"). Write a real task ABOUT the topic.
- CONCRETE: include specifics appropriate to the experienceType — for an
  applied_problem, give actual numbers/data/inputs and ask for a checkable
  result; for a socratic question, name the specific concept and the angle to
  reason about; for a mini_project, state a clear deliverable and its
  constraints (length, parts, format).
- A real prompt, not a placeholder. Never emit empty, one-word, or fragmentary
  prompts. Aim for at least one full sentence of instruction.

GAP COVERAGE — CRITICAL (L0.md §5). The path exists to close the learner's
assessed GAPS. For each goalpost, map its objective to the specific WEAK
competencies below (low estimatedLevel). Across the 3 goalposts you must cover
EVERY weak competency the assessment flagged. Do NOT spend a goalpost on a
competency the learner has already mastered (high level) — skip what they know
and concentrate effort where they are weak. State in each objective which
competency or outcome it advances.

GRANULARITY — CRITICAL (L0.md §9.1). estimatedMinutes for each goalpost MUST be
between 20 and 120, and you should TARGET 30-90 minutes. A goalpost that would
take less than 20 minutes is too thin (merge it); one over 120 minutes is too
big (split it). Give a realistic, honest per-goalpost estimate inside these
bounds.

TITLE & HEADING CASING — CRITICAL. Write every goalpost "title" and "objective"
in SENTENCE CASE: capitalize ONLY the first word and genuine proper nouns (names
of people, places, named theories/movements, languages, branded technologies —
e.g. "Art Nouveau", "French", "React", "Python", "the Default Mode Network" only
if that exact name is a proper noun). Do NOT Title-Case Every Word. Ordinary
technical terms stay lowercase mid-sentence (e.g. "default mode network",
"balance sheet", "dot product"). Examples:
  - "Understanding brain networks and the default mode network" (NOT "Understanding Brain Networks and the Default Mode Network")
  - "Reading a balance sheet" (NOT "Reading a Balance Sheet")
  - "The ideas behind Art Nouveau" (NOT "The Ideas Behind Art Nouveau")

Rules:
- Order goalposts 1..3 from foundational to ambitious.
- Number the information step order 1 and the experience step order 2.`;

type TelemetrySnapshot = {
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

export class LivePathOutliner implements PathOutliner {
  constructor(private readonly llm: LLMClient) {}

  /**
   * Best-effort per-call telemetry. Never allowed to break path outlining: the
   * caller wraps each invocation so a logging failure degrades to a warn.
   */
  private async recordLlmCall(snapshot: TelemetrySnapshot): Promise<void> {
    try {
      const model = snapshot.model ?? TELEMETRY_MODEL;
      const inputTokens = snapshot.usage?.inputTokens ?? 0;
      const outputTokens = snapshot.usage?.outputTokens ?? 0;
      await prisma.llmCall.create({
        data: {
          purpose: "path_outline",
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
        `[llm-telemetry] failed to persist path_outline row: ${
          (err as Error).message
        }`,
      );
    }
  }

  async outline(input: PathOutlinerInput): Promise<GoalpostPlan[]> {
    const startedAt = Date.now();
    let usage: CompletionResult["usage"] | undefined;
    let usageModel: string | undefined;
    let result: PathResult;
    try {
      result = await this.llm.completeStructured({
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              `Subject: ${input.subject.canonicalName}`,
              `Scope: ${input.subject.scopeNote}`,
              `Motivation: ${input.motivation}`,
              ``,
              `Target outcomes:`,
              ...input.outcome.map((o) => `- (${o.bloomLevel}) ${o.text}`),
              ``,
              `Assessed competencies (level 0-4, confidence 0-1):`,
              ...(input.assessment.length
                ? input.assessment.map(
                    (c) =>
                      `- ${c.competency}: level ${c.estimatedLevel} (confidence ${c.confidence})`,
                  )
                : ["- (no assessment available; assume a motivated beginner)"]),
              ``,
              `The WEAK competencies you must cover across the path (level <= ${GAP_LEVEL_THRESHOLD}):`,
              ...(this.weakCompetencies(input).length
                ? this.weakCompetencies(input).map((c) => `- ${c}`)
                : ["- (none flagged; treat the learner as a motivated beginner)"]),
              ``,
              `Design the 3-goalpost path.`,
            ].join("\n"),
          },
        ],
        temperature: 0.6,
        maxTokens: 8192,
        schema: pathResultSchema,
        schemaName: "LearningPath",
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

    // Reshape into the GoalpostPlan { steps[] } structure the wizard persists,
    // applying the L0 hard-constraint guards in code (the model is unreliable).
    const plans: GoalpostPlan[] = result.goalposts.map((gp) => {
      // GRANULARITY guard (L0.md §9.1): clamp to the hard 20-120 bound.
      const estimatedMinutes = this.clampMinutes(gp.estimatedMinutes, gp.title);

      // EXPERIENCE PROMPT QUALITY guard: reject/repair malformed prompts.
      const prompt = this.repairExperiencePrompt(
        gp.experience.prompt,
        gp.title,
        gp.objective,
        gp.experience.type,
      );

      return {
        order: gp.order,
        title: gp.title,
        objective: gp.objective,
        estimatedMinutes,
        // ≥1 EXPERIENCE STEP PER GOALPOST (L0.md §6): structurally guaranteed —
        // every goalpost always emits an information step AND an experience step.
        steps: [
          {
            order: gp.information.order,
            type: gp.information.type,
            payload: { content: gp.information.content, sourceIds: [] },
          },
          {
            order: gp.experience.order,
            type: gp.experience.type,
            payload: {
              prompt,
              rubricFocus: gp.experience.rubricFocus,
            },
          },
        ],
      };
    });

    // GAP COVERAGE check (L0.md §5): non-fatal. Code-side full verification is
    // hard, so we only warn if a clearly-weak competency name surfaces in NO
    // goalpost objective. The prompt is the primary enforcement.
    this.warnOnUncoveredGaps(input, plans);

    return plans;
  }

  /** Competencies the assessment flagged as weak (a gap the path must cover). */
  private weakCompetencies(input: PathOutlinerInput): string[] {
    return input.assessment
      .filter((c) => c.estimatedLevel <= GAP_LEVEL_THRESHOLD)
      .map((c) => c.competency);
  }

  /**
   * GRANULARITY (L0.md §9.1). Hard-clamp to [20, 120]. We also nudge values that
   * fall inside the hard bounds but outside the 30-90 target toward the target
   * edge, so the persisted estimate respects the recommended granularity band.
   */
  private clampMinutes(raw: number, title: string): number {
    const safe = Number.isFinite(raw) ? Math.round(raw) : TARGET_MIN_MINUTES;
    const clamped = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, safe));
    if (clamped !== safe) {
      // eslint-disable-next-line no-console
      console.warn(
        `[path-outliner] estimatedMinutes ${safe} for goalpost "${title}" out of hard bounds [${MIN_MINUTES}, ${MAX_MINUTES}]; clamped to ${clamped}.`,
      );
    }
    // Pull into the 30-90 target band without crossing the hard bounds.
    if (clamped < TARGET_MIN_MINUTES) return TARGET_MIN_MINUTES;
    if (clamped > TARGET_MAX_MINUTES) return Math.min(clamped, MAX_MINUTES);
    return clamped;
  }

  /**
   * EXPERIENCE PROMPT QUALITY guard (fixes the line-of-questions bug). A prompt
   * shorter than MIN_PROMPT_CHARS (after trim) is malformed/degenerate; rather
   * than ship a nonsensical prompt to the learner we substitute a well-formed,
   * self-contained fallback task built from the goalpost objective. Prompts that
   * pass the length check are returned trimmed and unchanged.
   */
  private repairExperiencePrompt(
    raw: string,
    title: string,
    objective: string,
    type: GoalpostPlan["steps"][number]["type"],
  ): string {
    const trimmed = (raw ?? "").trim();
    if (trimmed.length >= MIN_PROMPT_CHARS) return trimmed;

    // eslint-disable-next-line no-console
    console.warn(
      `[path-outliner] malformed experience prompt for goalpost "${title}" (length ${trimmed.length} < ${MIN_PROMPT_CHARS}); substituting a generated fallback task.`,
    );

    const focus = objective.trim() || title.trim();
    switch (type) {
      case "experience_socratic":
        return `In your own words, explain the core idea behind "${focus}". Walk through WHY it works the way it does, and give one concrete example that shows you understand it rather than just restating a definition.`;
      case "experience_mini_project":
        return `Produce a small artifact that demonstrates "${focus}". Keep it focused: state your goal in one sentence, build the smallest thing that proves the concept, and write 3-4 sentences explaining the choices you made.`;
      case "experience_applied_problem":
      default:
        return `Work through a concrete problem that applies "${focus}". Set up the problem, show every step of your reasoning and arithmetic, and state the final result clearly so it can be checked.`;
    }
  }

  /**
   * GAP COVERAGE (L0.md §5), non-fatal. Warns once per weak competency whose
   * name does not appear (case-insensitive substring) in ANY goalpost objective.
   * This is a best-effort signal for QA/telemetry, not a hard gate — the prompt
   * carries the real enforcement.
   */
  private warnOnUncoveredGaps(
    input: PathOutlinerInput,
    plans: GoalpostPlan[],
  ): void {
    const weak = this.weakCompetencies(input);
    if (weak.length === 0) return;

    const objectives = plans
      .map((p) => `${p.title}\n${p.objective}`.toLowerCase())
      .join("\n");

    for (const competency of weak) {
      if (!objectives.includes(competency.toLowerCase())) {
        // eslint-disable-next-line no-console
        console.warn(
          `[path-outliner] gap competency "${competency}" was flagged weak but appears in no goalpost objective; the path may not cover it (L0.md §5).`,
        );
      }
    }
  }
}
