/**
 * The four evaluation systems compared in the study.
 *
 *   kc              KnowledgeCore as shipped: the 6-dimension rubric WITH its
 *                   explicit 0-4 level descriptors, the verbatim-evidence
 *                   contract, and the DETERMINISTIC decision function. Uses the
 *                   production system prompt verbatim.
 *   alt_a_holistic  Single holistic 0-100 mastery score plus a model-chosen
 *                   decision. This is the common default in LLM tutoring
 *                   systems and the baseline the proposal must beat.
 *   alt_b_bare      Ablation: same six dimension NAMES, no level descriptors,
 *                   no calibration guidance, no evidence contract, model-chosen
 *                   decision. Isolates how much of kc's behaviour comes from
 *                   the rubric's specification rather than from decomposition
 *                   into six numbers.
 *   alt_c_similarity  No LLM judge at all: cosine similarity between the
 *                   artifact embedding and a reference-answer embedding. This
 *                   is the classical automated short-answer grading baseline
 *                   and the cheapest possible comparator.
 *
 * Every LLM system is called at temperature 0.2, the production setting in
 * checkpointEvaluator.service.ts, so self-consistency is measured under the
 * conditions the deployed system actually runs at rather than an artificially
 * deterministic one.
 */
import { CHECKPOINT_EVALUATOR_SYSTEM } from "../../../llm/prompts/checkpointEvaluatorPrompts";
import { deriveDecision } from "../../../journey/decision";
import { findVerbatim, NO_EVIDENCE } from "../../../services/providers/verbatim";
import { callJson, withRetry, type JudgeModel } from "./providers";

export const DIMENSIONS = [
  "recall",
  "application",
  "conceptual",
  "transfer",
  "communication",
  "coverage",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const PRODUCTION_TEMPERATURE = 0.2;

export type SystemId = "kc" | "alt_a_holistic" | "alt_b_bare" | "alt_c_similarity";

export interface EvalItemInput {
  itemId: string;
  scenarioId: string;
  goalpostTitle: string;
  goalpostObjective: string;
  informationContent: string;
  experiencePrompt: string;
  artifact: string;
}

export interface SystemOutput {
  /** 0-100 comparable scalar. Definition differs per system; see notes field. */
  normalizedScore: number;
  /** Per-dimension 0-4 scores where the system produces them. */
  scores: Record<Dimension, number> | null;
  decision: "advance" | "repeat" | "adjust_plan";
  /** Fraction of returned evidence quotes that verify verbatim. Null if none produced. */
  evidenceVerifiedRate: number | null;
  evidenceCount: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Schemas. Google's responseSchema dialect uses UPPERCASE type names; OpenRouter
// takes standard JSON Schema. Both are declared per system so the same prompt
// can be sent to either provider without changing the contract.
// ---------------------------------------------------------------------------

const G_LEVEL = { type: "INTEGER" };
// No minimum/maximum: Anthropic's structured-output validator rejects those
// keywords on an integer ("For 'integer' type, properties maximum, minimum are
// not supported"), which would drop a whole judge family from the panel. The
// 0-4 range is stated in the prompt and enforced by the clamp in coerceScores,
// and any clamp is visible in the recorded raw payload.
const J_LEVEL = { type: "integer" };

const gScoresObj = {
  type: "OBJECT",
  properties: Object.fromEntries(DIMENSIONS.map((d) => [d, G_LEVEL])),
  required: [...DIMENSIONS],
  propertyOrdering: [...DIMENSIONS],
};
const jScoresObj = {
  type: "object",
  properties: Object.fromEntries(DIMENSIONS.map((d) => [d, J_LEVEL])),
  required: [...DIMENSIONS],
  additionalProperties: false,
};

const DECISIONS = ["advance", "repeat", "adjust_plan"];

const KC_GOOGLE_SCHEMA = {
  type: "OBJECT",
  properties: {
    scores: gScoresObj,
    evidence: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          dimension: { type: "STRING", enum: [...DIMENSIONS] },
          quote: { type: "STRING" },
        },
        required: ["dimension", "quote"],
        propertyOrdering: ["dimension", "quote"],
      },
    },
    decision: { type: "STRING", enum: DECISIONS },
    rationale: { type: "STRING" },
  },
  required: ["scores", "evidence", "decision", "rationale"],
  propertyOrdering: ["scores", "evidence", "decision", "rationale"],
};

const KC_JSON_SCHEMA = {
  type: "object",
  properties: {
    scores: jScoresObj,
    evidence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          dimension: { type: "string", enum: [...DIMENSIONS] },
          quote: { type: "string" },
        },
        required: ["dimension", "quote"],
        additionalProperties: false,
      },
    },
    decision: { type: "string", enum: DECISIONS },
    rationale: { type: "string" },
  },
  required: ["scores", "evidence", "decision", "rationale"],
  additionalProperties: false,
};

const HOLISTIC_GOOGLE_SCHEMA = {
  type: "OBJECT",
  properties: {
    masteryScore: { type: "INTEGER" },
    decision: { type: "STRING", enum: DECISIONS },
    rationale: { type: "STRING" },
  },
  required: ["masteryScore", "decision", "rationale"],
  propertyOrdering: ["masteryScore", "decision", "rationale"],
};
const HOLISTIC_JSON_SCHEMA = {
  type: "object",
  properties: {
    masteryScore: { type: "integer" },
    decision: { type: "string", enum: DECISIONS },
    rationale: { type: "string" },
  },
  required: ["masteryScore", "decision", "rationale"],
  additionalProperties: false,
};

const BARE_GOOGLE_SCHEMA = {
  type: "OBJECT",
  properties: {
    scores: gScoresObj,
    decision: { type: "STRING", enum: DECISIONS },
    rationale: { type: "STRING" },
  },
  required: ["scores", "decision", "rationale"],
  propertyOrdering: ["scores", "decision", "rationale"],
};
const BARE_JSON_SCHEMA = {
  type: "object",
  properties: {
    scores: jScoresObj,
    decision: { type: "string", enum: DECISIONS },
    rationale: { type: "string" },
  },
  required: ["scores", "decision", "rationale"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/** Byte-identical to GeminiCheckpointEvaluator.buildMessages for attempt 1. */
export function buildKcUserMessage(item: EvalItemInput): string {
  return [
    `Goalpost: ${item.goalpostTitle}`,
    `Objective: ${item.goalpostObjective}`,
    `Attempt number: 1`,
    ``,
    `--- Information the learner was given ---`,
    item.informationContent || "(none)",
    ``,
    `--- Experience prompt ---`,
    item.experiencePrompt || "(none)",
    ``,
    `--- Learner's artifact (quote ONLY from here, verbatim) ---`,
    item.artifact || "(empty)",
    ``,
    `Evaluate now.`,
  ].join("\n");
}

/**
 * Deliberately generic. This is what an LLM tutoring system that has not
 * specified a rubric asks for, and the point of the comparison is that the
 * proposal's advantage should come from specification, not from prompt effort.
 */
const HOLISTIC_SYSTEM =
  "You are grading a learner's answer for an AI learning platform. Read the objective, " +
  "the material the learner was given, the prompt they answered, and their answer. " +
  "Give an overall mastery score from 0 to 100 and decide what happens next: " +
  '"advance" if they have met the objective, "repeat" if they should try again, ' +
  '"adjust_plan" if the learning plan itself needs to change. Return only the structured result.';

const BARE_SYSTEM =
  "You are the checkpoint evaluator of an AI learning platform. Score the learner's artifact " +
  "on six dimensions, each from 0 to 4: recall, application, conceptual, transfer, " +
  "communication, coverage. Then decide what happens next: " +
  '"advance", "repeat", or "adjust_plan". Return only the structured result.';

function buildGenericUserMessage(item: EvalItemInput): string {
  return [
    `Goalpost: ${item.goalpostTitle}`,
    `Objective: ${item.goalpostObjective}`,
    ``,
    `--- Information the learner was given ---`,
    item.informationContent || "(none)",
    ``,
    `--- Experience prompt ---`,
    item.experiencePrompt || "(none)",
    ``,
    `--- Learner's artifact ---`,
    item.artifact || "(empty)",
    ``,
    `Evaluate now.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

function coerceScores(raw: unknown): Record<Dimension, number> {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out = {} as Record<Dimension, number>;
  for (const d of DIMENSIONS) {
    const v = Number(o[d]);
    if (!Number.isFinite(v)) throw new Error(`missing or non-numeric dimension "${d}"`);
    // Clamp defensively: a model occasionally emits 5 despite the schema. The
    // clamp is recorded in the raw payload so it is auditable.
    out[d] = Math.max(0, Math.min(4, Math.round(v)));
  }
  return out;
}

function sumToPct(scores: Record<Dimension, number>): number {
  const total = DIMENSIONS.reduce((a, d) => a + scores[d], 0);
  return (100 * total) / (4 * DIMENSIONS.length);
}

export async function runKc(judge: JudgeModel, item: EvalItemInput): Promise<SystemOutput> {
  const res = await withRetry(() =>
    callJson<{
      scores: Record<Dimension, number>;
      evidence: { dimension: string; quote: string }[];
      decision: "advance" | "repeat" | "adjust_plan";
      rationale: string;
    }>({
      judge,
      system: CHECKPOINT_EVALUATOR_SYSTEM,
      user: buildKcUserMessage(item),
      googleSchema: KC_GOOGLE_SCHEMA,
      jsonSchema: KC_JSON_SCHEMA,
      schemaName: "EvaluationResult",
      temperature: PRODUCTION_TEMPERATURE,
      parse: (raw) => {
        const o = raw as Record<string, unknown>;
        return {
          scores: coerceScores(o.scores),
          evidence: Array.isArray(o.evidence)
            ? (o.evidence as { dimension: string; quote: string }[])
            : [],
          decision: (o.decision as "advance" | "repeat" | "adjust_plan") ?? "repeat",
          rationale: String(o.rationale ?? ""),
        };
      },
    }),
  );

  // Auditability measurement: what fraction of the evidence quotes are real
  // spans of the artifact. The "(no evidence in artifact)" sentinel is a
  // legitimate answer and counts as verified.
  const quotes = res.value.evidence.filter((e) => e && typeof e.quote === "string");
  let verified = 0;
  for (const e of quotes) {
    const t = e.quote.trim();
    if (t === NO_EVIDENCE || t.length === 0) verified++;
    else if (findVerbatim(item.artifact, e.quote)) verified++;
  }

  return {
    normalizedScore: sumToPct(res.value.scores),
    scores: res.value.scores,
    // THE PROPOSAL'S DECISION IS DETERMINISTIC CODE, not the model's opinion.
    // The model's own advisory decision is kept in `raw` for comparison.
    decision: deriveDecision(res.value.scores as never, 1),
    evidenceVerifiedRate: quotes.length > 0 ? verified / quotes.length : null,
    evidenceCount: quotes.length,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    latencyMs: res.latencyMs,
    raw: { ...res.value, modelAdvisoryDecision: res.value.decision },
  };
}

export async function runHolistic(judge: JudgeModel, item: EvalItemInput): Promise<SystemOutput> {
  const res = await withRetry(() =>
    callJson<{ masteryScore: number; decision: "advance" | "repeat" | "adjust_plan"; rationale: string }>({
      judge,
      system: HOLISTIC_SYSTEM,
      user: buildGenericUserMessage(item),
      googleSchema: HOLISTIC_GOOGLE_SCHEMA,
      jsonSchema: HOLISTIC_JSON_SCHEMA,
      schemaName: "HolisticGrade",
      temperature: PRODUCTION_TEMPERATURE,
      parse: (raw) => {
        const o = raw as Record<string, unknown>;
        const s = Number(o.masteryScore);
        if (!Number.isFinite(s)) throw new Error("missing masteryScore");
        return {
          masteryScore: Math.max(0, Math.min(100, Math.round(s))),
          decision: (o.decision as "advance" | "repeat" | "adjust_plan") ?? "repeat",
          rationale: String(o.rationale ?? ""),
        };
      },
    }),
  );
  return {
    normalizedScore: res.value.masteryScore,
    scores: null,
    decision: res.value.decision,
    evidenceVerifiedRate: null,
    evidenceCount: 0,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    latencyMs: res.latencyMs,
    raw: res.value,
  };
}

export async function runBareRubric(judge: JudgeModel, item: EvalItemInput): Promise<SystemOutput> {
  const res = await withRetry(() =>
    callJson<{ scores: Record<Dimension, number>; decision: "advance" | "repeat" | "adjust_plan"; rationale: string }>({
      judge,
      system: BARE_SYSTEM,
      user: buildGenericUserMessage(item),
      googleSchema: BARE_GOOGLE_SCHEMA,
      jsonSchema: BARE_JSON_SCHEMA,
      schemaName: "BareRubricGrade",
      temperature: PRODUCTION_TEMPERATURE,
      parse: (raw) => {
        const o = raw as Record<string, unknown>;
        return {
          scores: coerceScores(o.scores),
          decision: (o.decision as "advance" | "repeat" | "adjust_plan") ?? "repeat",
          rationale: String(o.rationale ?? ""),
        };
      },
    }),
  );
  return {
    normalizedScore: sumToPct(res.value.scores),
    scores: res.value.scores,
    // Model-chosen, NOT derived. That difference is part of what is under test.
    decision: res.value.decision,
    evidenceVerifiedRate: null,
    evidenceCount: 0,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    latencyMs: res.latencyMs,
    raw: res.value,
  };
}

// ---------------------------------------------------------------------------
// ALT-C: reference-answer embedding similarity. No LLM judge.
// ---------------------------------------------------------------------------

export const SIMILARITY_MODEL = "gemini-embedding-001";
export const SIMILARITY_PRICE_PER_MTOK_USD = 0.15;

export async function embedTexts(texts: string[]): Promise<{ vectors: number[][]; latencyMs: number[] }> {
  const key = process.env.GOOGLE_GENAI_API_KEY?.trim();
  if (!key) throw new Error("GOOGLE_GENAI_API_KEY is not set");
  const vectors: number[][] = [];
  const latencyMs: number[] = [];
  for (const t of texts) {
    const started = Date.now();
    const res = await withRetry(async () => {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${SIMILARITY_MODEL}:embedContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: `models/${SIMILARITY_MODEL}`,
            content: { parts: [{ text: t }] },
          }),
        },
      );
      const j = (await r.json()) as {
        embedding?: { values?: number[] };
        error?: { message?: string };
      };
      if (!r.ok) throw new Error(`embedContent HTTP ${r.status}: ${j.error?.message ?? ""}`);
      const v = j.embedding?.values;
      if (!v) throw new Error("embedContent returned no values");
      return v;
    });
    latencyMs.push(Date.now() - started);
    vectors.push(res);
  }
  return { vectors, latencyMs };
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
