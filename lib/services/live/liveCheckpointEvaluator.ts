import type { LLMClient } from "@/lib/llm";
import type {
  CheckpointEvaluator,
  EvaluationResult,
  EvaluatorInput,
  EvidenceQuote,
} from "@/lib/services/types";
import { evaluationResultSchema } from "./schemas";

const SYSTEM = `You are the checkpoint evaluator of an AI learning platform. A
learner has just submitted an artifact in response to an experience prompt. Score
it against a 6-dimension rubric and decide what happens next.

Rubric dimensions (each 0-4):
- recall: did they correctly remember the relevant facts/definitions?
- application: did they correctly apply the method/procedure?
- conceptual: do they show real understanding, not just mechanics?
- transfer: can they connect it to a new context?
- communication: is the explanation clear and well-structured?
- coverage: did they address the whole prompt?

Decision:
- "advance": the learner has clearly met the goalpost objective.
- "repeat": there are fixable gaps; ask them to try again.
- "adjust_plan": the artifact reveals a missing PREREQUISITE such that repeating
  this same goalpost will not help; the path itself should change. Prefer this
  over endlessly repeating.

EVIDENCE — CRITICAL: For each scored dimension provide an evidence quote. Every
quote MUST be copied VERBATIM, character-for-character, from the learner's
artifact below. Do NOT paraphrase, summarize, fix typos, or add words. Copy an
exact span of their text. If the artifact is empty or a dimension has no
supporting text, use the exact string "(no evidence in artifact)".`;

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

export class LiveCheckpointEvaluator implements CheckpointEvaluator {
  constructor(private readonly llm: LLMClient) {}

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

    const result = await this.llm.completeStructured({
      system: SYSTEM,
      messages: this.buildMessages(input),
      temperature: 0.2,
      maxTokens: 2048,
      schema: evaluationResultSchema,
      schemaName: "EvaluationResult",
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
    try {
      repaired = await this.llm.completeStructured({
        system: SYSTEM,
        messages: this.buildMessages(input, repairNote),
        temperature: 0,
        maxTokens: 2048,
        schema: evaluationResultSchema,
        schemaName: "EvaluationResult",
      });
    } catch (err) {
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
    // Preserve first-seen dimension order.
    const order: string[] = [];
    const resolved = new Map<string, EvidenceQuote>(); // dimension -> verified entry
    const fallback = new Map<string, string>(); // dimension -> first raw quote

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
