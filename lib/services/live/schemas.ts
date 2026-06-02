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

// L0.md §3 Stage 2 ambiguity surfacing. Gemini emits the ambiguity fields even
// when unambiguous (false / null), so accept null/missing here. This stays a
// plain object (no top-level .transform) because a transformed schema passed
// directly to completeStructured<T> unifies T to the pre-transform input type;
// liveIntentParser normalizes the nullish fields to undefined after parsing.
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

// Multi-turn interview step. Modeled as a flat object (rather than a Zod
// discriminated union) because Gemini structured output handles a single object
// shape with a `kind` enum more reliably than oneOf/anyOf. The optional fields
// are normalized in liveGoalInterviewer based on `kind`:
//   - kind="question"  -> `question` is required
//   - kind="complete"  -> `canDoStatements` (>=3) and `successCriterion` required
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

// Per-question judgement emitted by the scorer, keyed back to the probe
// question by id. Assembled in code into ProbeTranscriptEntry rows (the
// question prompt + learner answer come from the passed-in questions/answers,
// the model only supplies the one-sentence judgement of what the answer
// revealed). Powers KnowledgeAssessment.probeTranscript / the §7 loop.
export const probeJudgementSchema = z.object({
  questionId: z.string().min(1),
  judgement: z.string().min(1),
});

export const competenciesResultSchema = z.object({
  competencies: z.array(competencySchema).min(1),
  judgements: z.array(probeJudgementSchema),
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
//
// L1 — SKELETON ONLY (redesign §9). The PathOutliner (Call A) NO LONGER authors
// the information markdown: the two-phase pipeline (was Call B) overwrites it on
// entry, so any Call-A content was wasted work AND a second ASCII-art surface. The
// information step still exists STRUCTURALLY (it keeps its `order` and `type`), but
// its `content` is no longer produced — it is dropped from the schema so Gemini
// does not author 250-500 words per goalpost. The outliner fills a placeholder; the
// pipeline fills the real content lazily.
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

// L1 Slice 4 — a single VISUAL NEED the lesson generator emits, tagged with the
// closed `visualKind` set the gate switches on. `svgSource` carries inline SVG
// the model authored (diagram route only); `query` is a search string (image /
// video routes). Both are nullish so Gemini can emit the field uniformly. The
// kinds mirror lib/services/visualMedia.ts VISUAL_KINDS exactly.
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

export const visualNeedSchema = z.object({
  id: z.string().min(1),
  visualKind: visualKindSchema,
  caption: z.string().min(1),
  query: z.string().nullish(),
  svgSource: z.string().nullish(),
});

// L1 Slice 1 + 4 — Call B (lesson-content) output. The generator returns the
// markdown information content for one goalpost PLUS its visual needs (each a
// structured visualKind the gate routes). Structure already exists from Call A.
//
// NOTE: this is the LEGACY single-call Call-B schema, kept for the interim
// LiveLessonContentGenerator (left intact for QA reference). The LIVE path now
// runs the two-phase pipeline whose Author uses `authoredLessonSchema` below.
export const lessonContentResultSchema = z.object({
  content: z.string().min(1),
  visuals: z.array(visualNeedSchema).nullish(),
});

// =====================================================================
// L1 — Two-Phase Visual Lesson Pipeline (Slice 2): the Phase-1 AUTHOR schema.
//
// THE ANTI-ASCII GUARANTEE (redesign §6). This schema is the structured-output
// contract for the Author call. The decisive property: there is NO field through
// which the Author can emit a DRAWN figure — no `svgSource`, no `svg`, no `draw`,
// no ASCII canvas. A visual is described ONLY as { kind, spec }. Because the model
// literally has no slot to put a picture in, ASCII-art diagrams are STRUCTURALLY
// IMPOSSIBLE here, not merely forbidden by an unreliable negative instruction.
// The drawn payload is produced LATER, by a dedicated Phase-2 worker, from `spec`.
//
// CONVERTER CONSTRAINT: the Gemini responseSchema converter (lib/llm/gemini.ts)
// has no oneOf/anyOf, so a block CANNOT be a z.union of two object shapes (it
// would throw at conversion). A block is therefore modeled as ONE flat object
// with a `type` enum ("prose" | "visual") and per-variant fields that are nullish
// at the schema level and normalized in code by `type` — exactly the established
// pattern used by interviewStepSchema. This keeps the schema converter-safe while
// preserving the no-draw guarantee (there is still no draw field anywhere).
//   - type="prose"  -> `md` carries the self-contained markdown.
//   - type="visual" -> `kind` (closed visualKind) + `spec` (rich description).
// =====================================================================

export const authoredBlockSchema = z.object({
  // The block discriminator. A flat enum (NOT a union of object shapes) so the
  // Gemini converter can represent it.
  type: z.enum(["prose", "visual"]),
  // PROSE branch: self-contained markdown. NO verbal visual dependencies
  // ("see the diagram below") — enforced in the system prompt. Nullish so the
  // visual branch can omit it; normalized in code.
  md: z.string().nullish(),
  // VISUAL branch: the closed visualKind the gate routes on. The Author picks
  // WHAT kind of picture the concept needs; it does NOT and CANNOT draw it.
  kind: visualKindSchema.nullish(),
  // VISUAL branch: a RICH description of what the picture must show (intent,
  // labels, values, structure) — the Phase-2 worker's input. This is prose ABOUT
  // a picture, never a picture. There is deliberately no svgSource/draw sibling.
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
