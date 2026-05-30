import { z } from "zod";

// =====================================================================
// Zod schemas mirroring lib/services/types.ts, used both to drive Gemini
// structured output (responseSchema) and to validate the parsed result.
// Kept in one place so the live services share a single source of truth.
// =====================================================================

export const bloomLevelSchema = z.enum([
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
]);

// Rubric / competency levels are 0-4. Modeled as a literal union so the parsed
// output type narrows to 0 | 1 | 2 | 3 | 4 (matching lib/services/types.ts)
// without an unsafe cast.
export const rubricLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const parsedSubjectSchema = z.object({
  canonicalName: z.string().min(1),
  scopeNote: z.string().min(1),
});

export const canDoStatementSchema = z.object({
  text: z.string().min(1),
  bloomLevel: bloomLevelSchema,
});

export const goalInterviewResultSchema = z.object({
  canDoStatements: z.array(canDoStatementSchema).min(1),
});

export const probeQuestionSchema = z
  .object({
    id: z.string().min(1),
    prompt: z.string().min(1),
    kind: z.enum(["open", "multiple_choice"]),
    // Gemini emits the field even for open questions, returning null. Accept
    // null/missing and normalize to undefined so it matches ProbeQuestion.
    options: z.array(z.string()).nullish(),
    competencyTag: z.string().min(1),
  })
  .transform((q) => ({
    ...q,
    options: q.options ?? undefined,
  }));

export const probeQuestionsResultSchema = z.object({
  questions: z.array(probeQuestionSchema).min(1),
});

export const competencySchema = z.object({
  competency: z.string().min(1),
  estimatedLevel: rubricLevelSchema,
  confidence: z.number().min(0).max(1),
});

export const competenciesResultSchema = z.object({
  competencies: z.array(competencySchema).min(1),
});

// Step types Gemini may emit. The schema/database also allow
// experience_mini_project; we keep the enum aligned with Prisma StepType.
export const stepTypeSchema = z.enum([
  "information",
  "experience_socratic",
  "experience_applied_problem",
  "experience_mini_project",
]);

// Information step payload.
export const informationStepSchema = z.object({
  order: z.number().int(),
  type: z.literal("information"),
  content: z.string().min(1),
});

// Experience step payload.
export const experienceStepSchema = z.object({
  order: z.number().int(),
  type: z.enum([
    "experience_socratic",
    "experience_applied_problem",
    "experience_mini_project",
  ]),
  prompt: z.string().min(1),
  rubricFocus: z.array(
    z.enum([
      "recall",
      "application",
      "conceptual",
      "transfer",
      "communication",
      "coverage",
    ]),
  ),
});

export const goalpostPlanSchema = z.object({
  order: z.number().int(),
  title: z.string().min(1),
  objective: z.string().min(1),
  estimatedMinutes: z.number().int().min(1),
  information: informationStepSchema,
  experience: experienceStepSchema,
});

export const pathResultSchema = z.object({
  goalposts: z.array(goalpostPlanSchema).min(1),
});

export const rubricScoresSchema = z.object({
  recall: rubricLevelSchema,
  application: rubricLevelSchema,
  conceptual: rubricLevelSchema,
  transfer: rubricLevelSchema,
  communication: rubricLevelSchema,
  coverage: rubricLevelSchema,
});

export const dimensionSchema = z.enum([
  "recall",
  "application",
  "conceptual",
  "transfer",
  "communication",
  "coverage",
]);

export const evidenceQuoteSchema = z.object({
  dimension: dimensionSchema,
  quote: z.string(),
});

export const decisionSchema = z.enum(["advance", "repeat", "adjust_plan"]);

export const evaluationResultSchema = z.object({
  scores: rubricScoresSchema,
  evidence: z.array(evidenceQuoteSchema).min(1),
  decision: decisionSchema,
  rationale: z.string().min(1),
});
