/**
 * Orphaned-guest cleanup (landing-flow plan, section 5 + slice 4).
 *
 * Deletes anonymous (guest) User rows that were never linked to a real account
 * and have been idle past the retention window. The User -> LearningIntent ->
 * (Subject / Goal / Outcome / Assessment / Path / Goalpost / Step /
 * CheckpointEvaluation) and User -> ... -> LearnerProfile (-> snapshots) graph is
 * all onDelete: Cascade, so deleting the guest user removes its whole journey
 * cleanly; the two telemetry FKs that point INTO the graph (LlmCall.evaluationId,
 * PathRevision.triggerEvalId) are onDelete: SetNull, so nothing is orphaned.
 *
 * Conservative + idempotent: it ONLY touches isAnonymous=true users older than
 * the window. A real account (isAnonymous=false) or a fresh guest is never
 * touched. Safe to run repeatedly (e.g. a Vercel cron / scheduled job).
 *
 * Run: `bun run scripts/cleanup-guests.ts` (add `--dry` to only report counts).
 */
import { prisma } from "@/lib/db";

const RETAIN_DAYS = Number(process.env.GUEST_RETENTION_DAYS ?? 30);
const DRY = process.argv.includes("--dry");

export async function cleanupOrphanedGuests(
  retainDays = RETAIN_DAYS,
  dry = false,
): Promise<{ candidates: number; deleted: number; cutoff: Date }> {
  const cutoff = new Date(Date.now() - retainDays * 24 * 60 * 60 * 1000);
  const where = { isAnonymous: true, updatedAt: { lt: cutoff } } as const;

  const candidates = await prisma.user.count({ where });
  if (dry) {
    return { candidates, deleted: 0, cutoff };
  }
  const { count } = await prisma.user.deleteMany({ where });
  return { candidates, deleted: count, cutoff };
}

// Only run when invoked directly (so tests can import the function without
// triggering a destructive run).
if (import.meta.main) {
  cleanupOrphanedGuests(RETAIN_DAYS, DRY)
    .then(async (r) => {
      console.log(
        `[cleanup-guests] cutoff=${r.cutoff.toISOString()} candidates=${r.candidates} deleted=${r.deleted}${DRY ? " (dry run)" : ""}`,
      );
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error("[cleanup-guests] FAILED:", e instanceof Error ? e.message : e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
