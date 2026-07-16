import { z } from "zod";

// Zod schemas mirroring lib/services/types.ts: they both drive Gemini structured
// output (responseSchema) and validate the parsed result.

export const bloomLevelSchema = z.enum([
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
]);

// Literal union (not z.number) so the parsed type narrows to 0|1|2|3|4 without a cast.
export const rubricLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

// Gemini emits the ambiguity fields even when unambiguous (false/null), so accept
// nullish. NO top-level .transform: a transformed schema passed to completeStructured<T>
// unifies T to the pre-transform input type; liveIntentParser normalizes nullish after.
export const parsedSubjectSchema = z.object({
  canonicalName: z.string().min(1),
  scopeNote: z.string().min(1),
  ambiguous: z.boolean().nullish(),
  clarification: z.string().nullish(),
});

export const canDoStatementSchema = z.object({
  text: z.string().min(1),
  bloomLevel: bloomLevelSchema,
});

export const goalInterviewResultSchema = z.object({
  canDoStatements: z.array(canDoStatementSchema).min(1),
});

// Flat object (not a discriminated union): the Gemini converter has no oneOf/anyOf,
// so the optional fields are normalized in liveGoalInterviewer by `kind`.
export const interviewStepSchema = z.object({
  kind: z.enum(["question", "complete"]),
  question: z.string().nullish(),
  canDoStatements: z.array(canDoStatementSchema).nullish(),
  successCriterion: z.string().nullish(),
});

export const probeQuestionSchema = z
  .object({
    id: z.string().min(1),
    prompt: z.string().min(1),
    kind: z.enum(["open", "multiple_choice"]),
    // Gemini emits options even for open questions (null); normalized to undefined below.
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

// One-sentence judgement keyed back to the probe question by id; assembled in code
// into ProbeTranscriptEntry rows with the passed-in prompt/answer.
export const probeJudgementSchema = z.object({
  questionId: z.string().min(1),
  judgement: z.string().min(1),
});

export const competenciesResultSchema = z.object({
  competencies: z.array(competencySchema).min(1),
  judgements: z.array(probeJudgementSchema),
});

// Aligned with Prisma StepType.
export const stepTypeSchema = z.enum([
  "information",
  "experience_socratic",
  "experience_applied_problem",
  "experience_mini_project",
]);

// SKELETON ONLY (redesign §9): the outliner emits structure (order + type); the
// two-phase pipeline authors `content` lazily on entry, so it is absent here.
export const informationStepSchema = z.object({
  order: z.number().int(),
  type: z.literal("information"),
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

// Mirrors lib/services/visualMedia.ts VISUAL_KINDS exactly.
export const visualKindSchema = z.enum([
  "diagram",
  "structural",
  "quantitative",
  "photographic",
  "real_world",
  "human",
  "situational",
  "process",
  "motion",
]);

// Phase-1 Author schema. Anti-ASCII guarantee (redesign §6): no field lets
// the Author emit a drawn figure — a visual is only { kind, spec }; the
// drawn payload comes later from a Phase-2 worker. Flat object (Gemini has
// no oneOf/anyOf) normalized in code by `type`.
export const authoredBlockSchema = z.object({
  type: z.enum(["prose", "visual"]),
  md: z.string().nullish(),
  kind: visualKindSchema.nullish(),
  spec: z.string().nullish(),
});

export const authoredSectionSchema = z.object({
  heading: z.string().min(1),
  blocks: z.array(authoredBlockSchema).min(1),
});

export const authoredLessonSchema = z.object({
  sections: z.array(authoredSectionSchema).min(1),
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
