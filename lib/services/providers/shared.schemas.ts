import { z } from "zod";

// Zod building blocks genuinely shared by more than one provider (mirrors
// lib/services/types.ts). Everything used by exactly one provider is
// colocated in that provider's own .service.ts file instead.

export const bloomLevelSchema = z.enum([
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
]);

// Literal union (not z.number) so the parsed type narrows to 0|1|2|3|4 without a cast.
// Shared by knowledgeProbe.service.ts (competencySchema) and
// checkpointEvaluator.service.ts (rubricScoresSchema).
export const rubricLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

// Gemini emits the ambiguity fields even when unambiguous (false/null), so accept
// nullish. NO top-level .transform: a transformed schema passed to completeStructured<T>
// unifies T to the pre-transform input type; the callers normalize nullish after.
// Shared by goalInterviewer.service.ts (interviewStepSchema) and
// outcomeReviser.service.ts (outcomeRevisionSchema).
export const canDoStatementSchema = z.object({
  text: z.string().min(1),
  bloomLevel: bloomLevelSchema,
});
