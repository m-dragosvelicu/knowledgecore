"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRealUserId } from "@/lib/auth-guards";
import { prisma } from "@/lib/journey/state";

const deleteJourneySchema = z.object({
  intentId: z.string().min(1),
});

/**
 * Delete one of the signed-in user's journeys (a LearningIntent) and ALL of its
 * dependent data.
 *
 * Data model / cascade: every child of LearningIntent declares onDelete: Cascade
 * in prisma/schema.prisma — Subject, LearningGoal, ExpectedOutcome,
 * KnowledgeAssessment, LearnerProfile (-> LearnerProfileSnapshot), and
 * LearningPath (-> Goalpost -> Step + CheckpointEvaluation, and PathRevision).
 * The two telemetry/audit FKs that point INTO this graph from outside are
 * onDelete: SetNull (LlmCall.evaluationId and PathRevision.triggerEvalId), so
 * deleting the intent cannot orphan rows or raise a FK violation. A single
 * delete therefore removes the whole journey cleanly.
 *
 * Authorization: ownership is enforced server-side at the database boundary via
 * deleteMany with BOTH id and userId in the where clause. A non-owner (or a bad
 * id) deletes zero rows — no row leak, no cross-user delete, no need to fetch the
 * row first. We never trust the client about ownership.
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
