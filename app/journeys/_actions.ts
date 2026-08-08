"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRealUserId } from "@/lib/auth-guards";
import { prisma } from "@/lib/db";

const deleteJourneySchema = z.object({
  intentId: z.string().min(1),
});

/**
 * Deletes one of the signed-in user's journeys (a LearningIntent) and all
 * dependent data. Every LearningIntent child cascades (onDelete: Cascade):
 * Subject, LearningGoal, ExpectedOutcome, KnowledgeAssessment, LearnerProfile
 * (-> Snapshot), LearningPath (-> Goalpost -> Step + CheckpointEvaluation,
 * PathRevision). The two FKs pointing in from outside (LlmCall.evaluationId,
 * PathRevision.triggerEvalId) are onDelete: SetNull, so nothing orphans.
 * Ownership is enforced via deleteMany with both id and userId in the where
 * clause — a non-owner deletes zero rows, no fetch-first needed.
 */
export async function deleteJourneyAction(formData: FormData): Promise<void> {
  const userId = await requireRealUserId();

  const { intentId } = deleteJourneySchema.parse({
    intentId: formData.get("intentId"),
  });

  // Ownership-scoped delete: only a row owned by this user is removed. The schema
  // cascades handle every dependent table; SetNull FKs avoid orphan/FK errors.
  await prisma.learningIntent.deleteMany({
    where: { id: intentId, userId },
  });

  // Refresh the list (and the home dashboard, whose journey rows read the same
  // data) so the deleted journey disappears.
  revalidatePath("/journeys");
  revalidatePath("/");
}
