/**
 * Founder ruling 2026-07-17: only a goalpost the learner actually submitted a
 * PASSING experience for (a CheckpointEvaluation with decision `advance`)
 * counts as done. Before lib/journey/path/revision.ts's applyPathAdjustment
 * fix, every adjust_plan reshape stamped the superseded current goalpost
 * `GoalpostStatus.complete` - the same value as genuine mastery - so every
 * progress counter miscounted it as passed.
 *
 * This is a one-time correction for rows written before the fix. For every
 * PathRevision with a triggerEvalId (a remediation reshape - pre-acceptance
 * confirmation revisions have triggerEvalId = null and never mark anything
 * complete, so they are not candidates), the trigger evaluation's goalpost is
 * exactly the goalpost applyPathAdjustment marked complete at reshape time.
 * If that goalpost is still `complete` and has no `advance` evaluation, it
 * was never actually passed - reset it to `superseded`.
 *
 * Defaults to report-only. Pass --apply to mutate. Prints every candidate's
 * before/after status.
 *
 * Run: `bun run scripts/backfill-superseded-goalpost-status.ts [--apply]`
 */
import { prisma } from "@/lib/db";
import { GoalpostStatus, Decision } from "@prisma/client";

const APPLY = process.argv.includes("--apply");

type Candidate = {
  goalpostId: string;
  order: number;
  title: string;
  pathId: string;
  revisionId: string;
};

async function findCandidates(): Promise<Candidate[]> {
  const revisions = await prisma.pathRevision.findMany({
    where: { triggerEvalId: { not: null } },
    include: { triggerEval: { include: { goalpost: true } } },
    orderBy: { createdAt: "asc" },
  });

  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  for (const rev of revisions) {
    const goalpost = rev.triggerEval?.goalpost;
    if (!goalpost) continue; // triggerEval FK is onDelete: SetNull; skip orphans
    if (goalpost.status !== GoalpostStatus.complete) continue;
    if (seen.has(goalpost.id)) continue;
    seen.add(goalpost.id);
    candidates.push({
      goalpostId: goalpost.id,
      order: goalpost.order,
      title: goalpost.title,
      pathId: goalpost.pathId,
      revisionId: rev.id,
    });
  }

  if (candidates.length === 0) return [];

  // Batch-check for a passing (advance) evaluation on each candidate.
  const evals = await prisma.checkpointEvaluation.findMany({
    where: { goalpostId: { in: candidates.map((c) => c.goalpostId) } },
    select: { goalpostId: true, decision: true },
  });
  const hasAdvance = new Set(
    evals.filter((e) => e.decision === Decision.advance).map((e) => e.goalpostId),
  );

  return candidates.filter((c) => !hasAdvance.has(c.goalpostId));
}

async function main() {
  console.log(`[backfill-superseded-goalpost-status] apply=${APPLY}`);

  const candidates = await findCandidates();
  if (candidates.length === 0) {
    console.log("No complete-via-reshape, never-passed goalposts found. Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nFound ${candidates.length} candidate(s):\n`);
  let updated = 0;
  for (const c of candidates) {
    const intent = await prisma.learningPath.findUnique({
      where: { id: c.pathId },
      select: { intentId: true },
    });
    console.log(
      `  intent=${intent?.intentId} goalpost=${c.goalpostId} order=${c.order} ` +
        `title=${JSON.stringify(c.title)} revision=${c.revisionId}`,
    );
    console.log(`    before: status=complete`);

    if (!APPLY) {
      console.log(`    --apply not passed: report-only, not mutating.`);
      continue;
    }

    await prisma.goalpost.update({
      where: { id: c.goalpostId },
      data: { status: GoalpostStatus.superseded },
    });
    console.log(`    after:  status=superseded`);
    updated++;
  }

  console.log(
    `\n[backfill-superseded-goalpost-status] candidates=${candidates.length} updated=${updated}` +
      `${APPLY ? "" : " (dry run - pass --apply to mutate)"}`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("[backfill-superseded-goalpost-status] crashed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
