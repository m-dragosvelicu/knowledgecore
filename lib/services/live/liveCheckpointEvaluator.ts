import type { CompletionResult, LLMClient } from "@/lib/llm";
import { prisma } from "@/lib/db";
import type {
  CheckpointEvaluator,
  EvaluationResult,
  EvaluatorInput,
  EvidenceQuote,
} from "@/lib/services/types";
import { evaluationResultSchema } from "./schemas";

// gemini-3.5-flash is the live default for L0 services. completeStructured only
// returns the parsed object (not a CompletionResult), so token usage is not
// surfaced here; we record the model name we dispatch on for telemetry.
const TELEMETRY_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

const SYSTEM = `You are the checkpoint evaluator of an AI learning platform. A
learner has just submitted an artifact in response to an experience prompt. Score
it against the 6-dimension rubric below and decide what happens next.

Each dimension is scored 0-4. Use these EXACT level descriptors — score each
dimension by finding the single cell that best matches the learner's artifact:

RECALL
  0 — Cannot reproduce key terms or facts.
  1 — Reproduces with prompts; some errors.
  2 — Reproduces accurately when asked.
  3 — Reproduces unprompted in correct context.
  4 — Connects facts across goalposts.

APPLICATION
  0 — Cannot execute the procedure.
  1 — Executes with hand-holding; errors.
  2 — Executes correctly on the given task.
  3 — Executes correctly on a varied task.
  4 — Executes correctly on a novel task.

CONCEPTUAL (conceptual understanding)
  0 — Treats concept as opaque label.
  1 — Restates definition.
  2 — Explains in own words with example.
  3 — Explains why and connects to prior concept.
  4 — Generates own analogies and counter-examples.

TRANSFER
  0 — No transfer attempted.
  1 — Transfers to near-identical case.
  2 — Transfers to similar case in same domain.
  3 — Transfers across sub-domains.
  4 — Identifies where the concept does not apply.

COMMUNICATION
  0 — Incoherent or absent.
  1 — Present but unclear.
  2 — Clear and structured.
  3 — Clear, structured, appropriately concise.
  4 — Pedagogically clear (could teach it).

COVERAGE (coverage match)
  0 — Artifact addresses none of the goalpost objective.
  1 — Addresses tangentially.
  2 — Addresses the stated objective.
  3 — Addresses objective and surfaces a related gap.
  4 — Addresses objective and a prerequisite the assessment missed.

CALIBRATION — USE THE FULL SCALE. Score honestly against the descriptors above;
do NOT reserve the top of the scale. A clearly-correct, well-explained answer
SHOULD receive a 3 or a 4 on the dimensions it satisfies. Level 4 (Mastery) is a
real, reachable score that you MUST award whenever the artifact matches the "4"
descriptor for that dimension — it is NOT reserved for impossible perfection, and
you must NOT shave a point off just to "leave room to improve." A genuinely
excellent, complete answer can and should score 4 on multiple dimensions. By the
same token, do not inflate weak work: if it matches a "1" descriptor, score 1.
Match the descriptor, nothing more and nothing less.

Decision (ADVISORY — the system derives the authoritative outcome from your
scores; still return your best-judgement decision):
- "advance": the learner has clearly met the goalpost objective.
- "repeat": there are fixable gaps; ask them to try again.
- "adjust_plan": the artifact reveals a missing PREREQUISITE such that repeating
  this same goalpost will not help; the path itself should change. Prefer this
  over endlessly repeating.

RATIONALE — VOICE: Write the "rationale" field in the SECOND PERSON, speaking
DIRECTLY to the learner as "you". It is a personal message TO them, not a report
ABOUT them. Say "You correctly explained..." / "You showed..." / "Try..." — never
"the learner", never their name, never narrate about them in the third person. Be
warm, direct, and specific: name what you got right and, where you fell short,
what to focus on next. Evidence quotes are the ONLY exception: they stay VERBATIM.

EVIDENCE — CRITICAL: For each scored dimension provide ONE evidence quote (one
quote per dimension). Every quote MUST be copied VERBATIM, character-for-
character, from the learner's artifact below. Do NOT paraphrase, summarize, fix
typos, or add words. Copy an exact span of their text. If the artifact is empty or
a dimension has no supporting text, use the exact string "(no evidence in
artifact)".`;

// ---------------------------------------------------------------------
// Verbatim-quote guard
// ---------------------------------------------------------------------

const NO_EVIDENCE = "(no evidence in artifact)";

/**
 * Normalize for substring comparison: lowercase, collapse whitespace, and fold
 * smart quotes / dashes to ASCII. We compare normalized forms but always RETURN
 * the original learner text span so the stored quote stays faithful.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns the original-cased substring of `artifact` that matches `quote`
 * (after normalization), or null if it is not a verbatim substring.
 */
function findVerbatim(artifact: string, quote: string): string | null {
  const q = quote.trim();
  if (q.length === 0) return null;

  // Fast path: exact substring.
  if (artifact.includes(q)) return q;

  // Normalized substring search. We normalize the artifact while keeping an
  // index map back to the original string so we can return the original span.
  const normQuote = normalize(q);
  if (normQuote.length === 0) return null;

  const map: number[] = []; // normalized index -> original index
  let norm = "";
  let prevWasSpace = false;
  for (let i = 0; i < artifact.length; i++) {
    let ch = artifact[i].toLowerCase();
    if ("‘’‛′".includes(ch)) ch = "'";
    else if ("“”″".includes(ch)) ch = '"';
    else if ("–—".includes(ch)) ch = "-";
    if (/\s/.test(ch)) {
      if (prevWasSpace) continue;
      ch = " ";
      prevWasSpace = true;
    } else {
      prevWasSpace = false;
    }
    norm += ch;
    map.push(i);
  }
  const trimmedNorm = norm.trim();
  const leadingTrim = norm.length - norm.trimStart().length;

  const idx = trimmedNorm.indexOf(normQuote);
  if (idx === -1) return null;

  const startNormIdx = idx + leadingTrim;
  const endNormIdx = startNormIdx + normQuote.length - 1;
  if (endNormIdx >= map.length) return null;
  const origStart = map[startNormIdx];
  const origEnd = map[endNormIdx];
  return artifact.slice(origStart, origEnd + 1);
}

type TelemetrySnapshot = {
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
  // completeStructured returns only the parsed object, so token usage from the
  // underlying CompletionResult is not available at this call site.
  usage?: CompletionResult["usage"];
};

export class LiveCheckpointEvaluator implements CheckpointEvaluator {
  constructor(private readonly llm: LLMClient) {}

  /**
   * Best-effort per-call telemetry. Wrapped in try/catch by the caller so a
   * logging failure can never break evaluation. evaluationId may be null because
   * the CheckpointEvaluation row often does not exist yet at eval time.
   */
  private async recordLlmCall(snapshot: TelemetrySnapshot): Promise<void> {
    try {
      await prisma.llmCall.create({
        data: {
          purpose: "checkpoint_evaluate",
          model: TELEMETRY_MODEL,
          inputTokens: snapshot.usage?.inputTokens ?? 0,
          outputTokens: snapshot.usage?.outputTokens ?? 0,
          // TODO: no pricing table yet — cost left at 0 until one exists.
          costMicroUsd: 0,
          latencyMs: snapshot.latencyMs,
          success: snapshot.success,
          errorMessage: snapshot.errorMessage,
          evaluationId: null,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[llm-telemetry] failed to persist checkpoint_evaluate row: ${
          (err as Error).message
        }`,
      );
    }
  }

  private buildMessages(input: EvaluatorInput, repairNote?: string) {
    const base = [
      `Goalpost: ${input.goalpostTitle}`,
      `Objective: ${input.goalpostObjective}`,
      `Attempt number: ${input.attempt}`,
      ``,
      `--- Information the learner was given ---`,
      input.informationContent || "(none)",
      ``,
      `--- Experience prompt ---`,
      input.experiencePrompt || "(none)",
      ``,
      `--- Learner's artifact (quote ONLY from here, verbatim) ---`,
      input.userArtifact || "(empty)",
      ``,
      `Evaluate now.`,
    ];
    if (repairNote) base.push("", repairNote);
    return [{ role: "user" as const, content: base.join("\n") }];
  }

  async evaluate(input: EvaluatorInput): Promise<EvaluationResult> {
    const artifact = input.userArtifact ?? "";

    const startedAt = Date.now();
    let result: EvaluationResult;
    try {
      result = await this.llm.completeStructured({
        system: SYSTEM,
        messages: this.buildMessages(input),
        temperature: 0.2,
        maxTokens: 2048,
        schema: evaluationResultSchema,
        schemaName: "EvaluationResult",
      });
    } catch (err) {
      await this.recordLlmCall({
        latencyMs: Date.now() - startedAt,
        success: false,
        errorMessage: (err as Error).message,
      });
      throw err;
    }
    await this.recordLlmCall({
      latencyMs: Date.now() - startedAt,
      success: true,
      errorMessage: null,
    });

    const verified = this.verifyEvidence(artifact, result.evidence);

    if (verified.unverifiedDimensions.length === 0) {
      return { ...result, evidence: verified.evidence };
    }

    // One repair attempt: ask the model to re-quote ONLY the failing dimensions
    // exactly. Keep the original scores/decision/rationale.
    const repairNote = [
      `Your previous evidence quotes for these dimensions were NOT verbatim`,
      `substrings of the learner's artifact: ${verified.unverifiedDimensions.join(", ")}.`,
      `Re-quote EXACTLY from the artifact for every dimension, copying a real`,
      `span character-for-character. Do not change your scores or decision.`,
    ].join(" ");

    let repaired: EvaluationResult | null = null;
    const repairStartedAt = Date.now();
    try {
      repaired = await this.llm.completeStructured({
        system: SYSTEM,
        messages: this.buildMessages(input, repairNote),
        temperature: 0,
        maxTokens: 2048,
        schema: evaluationResultSchema,
        schemaName: "EvaluationResult",
      });
      await this.recordLlmCall({
        latencyMs: Date.now() - repairStartedAt,
        success: true,
        errorMessage: null,
      });
    } catch (err) {
      await this.recordLlmCall({
        latencyMs: Date.now() - repairStartedAt,
        success: false,
        errorMessage: (err as Error).message,
      });
      // eslint-disable-next-line no-console
      console.warn(
        `[verbatim-guard] repair attempt failed to parse; degrading gracefully: ${
          (err as Error).message
        }`,
      );
    }

    if (repaired) {
      const reVerified = this.verifyEvidence(artifact, repaired.evidence);
      if (reVerified.unverifiedDimensions.length === 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[verbatim-guard] repair succeeded for dimensions: ${verified.unverifiedDimensions.join(
            ", ",
          )}`,
        );
        // Keep original scores/decision/rationale; take repaired verified quotes.
        return { ...result, evidence: reVerified.evidence };
      }
      // Merge: prefer whichever pass verified each quote.
      const merged = this.verifyEvidence(artifact, [
        ...repaired.evidence,
        ...result.evidence,
      ]);
      // eslint-disable-next-line no-console
      console.warn(
        `[verbatim-guard] repair partial; dimensions still unverified: ${merged.unverifiedDimensions.join(
          ", ",
        )} (flagged, scores kept)`,
      );
      return { ...result, evidence: merged.evidence };
    }

    // eslint-disable-next-line no-console
    console.warn(
      `[verbatim-guard] degrading gracefully; dimensions flagged unverified: ${verified.unverifiedDimensions.join(
        ", ",
      )} (scores kept)`,
    );
    return { ...result, evidence: verified.evidence };
  }

  /**
   * Produces exactly ONE evidence entry per dimension. For each dimension we
   * prefer the first quote that verifies as a verbatim substring (returning the
   * original-text span); a legitimate "(no evidence in artifact)" also counts as
   * resolved. If no occurrence of a dimension verifies, we emit a single
   * best-effort quote flagged "[unverified] " and report the dimension as
   * unverified so the caller can log/degrade gracefully.
   */
  private verifyEvidence(
    artifact: string,
    evidence: EvidenceQuote[],
  ): { evidence: EvidenceQuote[]; unverifiedDimensions: string[] } {
    type Dimension = EvidenceQuote["dimension"];
    // Preserve first-seen dimension order.
    const order: Dimension[] = [];
    const resolved = new Map<Dimension, EvidenceQuote>(); // dimension -> verified entry
    const fallback = new Map<Dimension, string>(); // dimension -> first raw quote

    for (const e of evidence) {
      if (!order.includes(e.dimension)) order.push(e.dimension);
      if (resolved.has(e.dimension)) continue; // already verified; ignore extras

      const trimmed = e.quote.trim();

      // A model may legitimately report no evidence.
      if (trimmed === NO_EVIDENCE || trimmed.length === 0) {
        resolved.set(e.dimension, { dimension: e.dimension, quote: NO_EVIDENCE });
        continue;
      }

      const verbatim = findVerbatim(artifact, e.quote);
      if (verbatim) {
        resolved.set(e.dimension, { dimension: e.dimension, quote: verbatim });
      } else if (!fallback.has(e.dimension)) {
        fallback.set(e.dimension, trimmed);
      }
    }

    const out: EvidenceQuote[] = [];
    const unverifiedDimensions: string[] = [];
    for (const dim of order) {
      const hit = resolved.get(dim);
      if (hit) {
        out.push(hit);
      } else {
        out.push({ dimension: dim, quote: `[unverified] ${fallback.get(dim) ?? ""}` });
        unverifiedDimensions.push(dim);
      }
    }

    return { evidence: out, unverifiedDimensions };
  }
}
