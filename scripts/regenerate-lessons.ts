/**
 * L1 — Two-Phase Visual Lesson Pipeline migration (redesign §10).
 *
 * One-shot, idempotent regeneration trigger. The lesson payload is JSON, so there
 * is NO Prisma migration; instead this script CLEARS `contentGeneratedAt` (and any
 * stale `generationState`) on every information step that was previously generated
 * by the OLD single-call path. Clearing that marker makes ensureLessonContent
 * treat the goalpost as "not generated", so the next entry / pre-generation
 * re-authors it through the new two-phase pipeline. No backfill: the new content
 * is produced lazily on demand, exactly like a fresh goalpost.
 *
 * SCOPE: only information steps whose payload still has `contentGeneratedAt` AND
 * carries the LEGACY single-call shape (a `content` string, no `sections` array).
 * A step already on the new LessonDoc shape is skipped, so re-running is a no-op.
 *
 * SAFETY: local dev DB only (Postgres :5440). It mutates JSON payloads in place;
 * it never deletes rows. Add `--dry` to report counts without writing.
 *
 * Run: `bun run scripts/regenerate-lessons.ts` (or `--dry`).
 */
import { StepType } from "@prisma/client";
import { prisma } from "@/lib/db";

const DRY = process.argv.includes("--dry");

type LegacyInfoPayload = {
  content?: string;
  sections?: unknown[];
  contentGeneratedAt?: string;
  generationState?: unknown;
  [key: string]: unknown;
};

export async function regenerateLessons(
  dry = false,
): Promise<{ scanned: number; cleared: number; skipped: number }> {
  const infoSteps = await prisma.step.findMany({
    where: { type: StepType.information },
    select: { id: true, payload: true },
  });

  let cleared = 0;
  let skipped = 0;

  for (const step of infoSteps) {
    const payload = (step.payload as LegacyInfoPayload | null) ?? {};
    const isLegacyGenerated =
      Boolean(payload.contentGeneratedAt) && !Array.isArray(payload.sections);
    if (!isLegacyGenerated) {
      skipped += 1;
      continue;
    }
    cleared += 1;
    if (dry) continue;

    // Strip the generation markers so ensureLessonContent re-authors on entry.
    // Keep the rest of the payload (e.g. the Call-A seed content) untouched; the
    // pipeline overwrites it with a fresh LessonDoc when it runs.
    const next: LegacyInfoPayload = { ...payload };
    delete next.contentGeneratedAt;
    delete next.generationState;

    await prisma.step.update({
      where: { id: step.id },
      data: { payload: next as object },
    });
  }

  return { scanned: infoSteps.length, cleared, skipped };
}

if (import.meta.main) {
  regenerateLessons(DRY)
    .then(async (r) => {
      console.log(
        `[regenerate-lessons] scanned=${r.scanned} cleared=${r.cleared} ` +
          `skipped=${r.skipped}${DRY ? " (dry run)" : ""}`,
      );
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(
        "[regenerate-lessons] FAILED:",
        e instanceof Error ? e.message : e,
      );
      await prisma.$disconnect();
      process.exit(1);
    });
}
