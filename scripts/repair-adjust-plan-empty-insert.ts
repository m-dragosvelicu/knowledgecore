/**
 * One-off repair for the 2026-07-17 adjust_plan empty-insert bug: before the
 * fix in lib/journey/path/revision.ts, applyPathAdjustment() unconditionally
 * stamped the current (just-failed) goalpost GoalpostStatus.complete even when
 * the PathAdjuster returned insertedGoalposts=[] (no remediation), silently
 * advancing the learner past a goalpost they never passed.
 *
 * This script does NOT assume which goalpost order was affected. For the
 * given LearningIntent it finds `complete` goalposts that have no PASSING
 * CheckpointEvaluation, then inspects the PathRevision whose triggerEvalId
 * matches that goalpost's adjust_plan evaluation:
 *   - insertedGoalposts.length === 0  -> exact bug signature, eligible for repair
 *   - insertedGoalposts.length >= 1   -> correct behavior by design (the
 *     goalpost is legitimately complete because a remediation goalpost was
 *     queued right after it); left untouched
 *   - no matching PathRevision found  -> ambiguous; left untouched, reported
 *
 * Only resets status to `in_progress` (no new enum value, no migration).
 * Prints before/after rows. Defaults to report-only; pass --apply to mutate.
 *
 * Run: `bun run scripts/repair-adjust-plan-empty-insert.ts [--intent=<id>] [--apply]`
 */
import { prisma } from "@/lib/db";
import { GoalpostStatus } from "@prisma/client";

const DEFAULT_INTENT_ID = "cmro295d60002xte5ski621gu";

function argValue(flag: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg?.slice(flag.length + 3);
}

const APPLY = process.argv.includes("--apply");
const INTENT_ID = argValue("intent") ?? DEFAULT_INTENT_ID;

type Signature =
  | { kind: "bug"; goalpostId: string; order: number; title: string; revisionId: string }
  | { kind: "correct-by-design"; goalpostId: string; order: number; insertedCount: number }
  | { kind: "ambiguous"; goalpostId: string; order: number; reason: string };

async function findSignatures(intentId: string): Promise<Signature[]> {
  const path = await prisma.learningPath.findUnique({
    where: { intentId },
    include: { goalposts: { orderBy: { order: "asc" } } },
  });
  if (!path) throw new Error(`No LearningPath for intent ${intentId}`);

  const results: Signature[] = [];

  for (const g of path.goalposts) {
    if (g.status !== GoalpostStatus.complete) continue;

    const evals = await prisma.checkpointEvaluation.findMany({
      where: { goalpostId: g.id },
      orderBy: { createdAt: "asc" },
    });
    const hasAdvance = evals.some((e) => e.decision === "advance");
    if (hasAdvance) continue; // legitimately passed (Decision.advance); not a candidate

    const lastAdjustPlan = [...evals].reverse().find((e) => e.decision === "adjust_plan");
    if (!lastAdjustPlan) {
      results.push({
        kind: "ambiguous",
        goalpostId: g.id,
        order: g.order,
        reason: "complete, no passing evaluation, but no adjust_plan evaluation either",
      });
      continue;
    }

    const revision = await prisma.pathRevision.findFirst({
      where: { pathId: path.id, triggerEvalId: lastAdjustPlan.id },
    });
    if (!revision) {
      results.push({
        kind: "ambiguous",
        goalpostId: g.id,
        order: g.order,
        reason: `adjust_plan evaluation ${lastAdjustPlan.id} has no matching PathRevision`,
      });
      continue;
    }

    const changes = revision.changes as { insertedGoalposts?: unknown[] } | null;
    const insertedCount = changes?.insertedGoalposts?.length ?? 0;
    if (insertedCount === 0) {
      results.push({
        kind: "bug",
        goalpostId: g.id,
        order: g.order,
        title: g.title,
        revisionId: revision.id,
      });
    } else {
      results.push({ kind: "correct-by-design", goalpostId: g.id, order: g.order, insertedCount });
    }
  }

  return results;
}

async function printGoalpostRow(goalpostId: string, label: string) {
  const g = await prisma.goalpost.findUnique({ where: { id: goalpostId } });
  console.log(
    `  [${label}] order=${g?.order} id=${g?.id} title=${JSON.stringify(g?.title)} status=${g?.status}`,
  );
}

async function main() {
  console.log(`[repair-adjust-plan-empty-insert] intent=${INTENT_ID} apply=${APPLY}`);

  const signatures = await findSignatures(INTENT_ID);
  if (signatures.length === 0) {
    console.log("No complete goalposts without a passing evaluation found. Nothing to inspect.");
    await prisma.$disconnect();
    return;
  }

  let repaired = 0;
  for (const sig of signatures) {
    if (sig.kind === "correct-by-design") {
      console.log(
        `SKIP order=${sig.order} goalpost=${sig.goalpostId}: complete via adjust_plan reshape with ` +
          `${sig.insertedCount} inserted goalpost(s) - correct by design, not the bug. Not touched.`,
      );
      continue;
    }
    if (sig.kind === "ambiguous") {
      console.log(
        `STOP order=${sig.order} goalpost=${sig.goalpostId}: ${sig.reason}. Not touched, needs manual review.`,
      );
      continue;
    }

    // sig.kind === "bug"
    console.log(`\nMATCH (bug signature) order=${sig.order} goalpost=${sig.goalpostId} title=${JSON.stringify(sig.title)}`);
    console.log(`  PathRevision ${sig.revisionId} has insertedGoalposts=[] (the empty-insert bug).`);
    console.log("  Before:");
    await printGoalpostRow(sig.goalpostId, "before");

    if (!APPLY) {
      console.log("  --apply not passed: report-only, not mutating.");
      continue;
    }

    await prisma.goalpost.update({
      where: { id: sig.goalpostId },
      data: { status: GoalpostStatus.in_progress },
    });
    console.log("  After:");
    await printGoalpostRow(sig.goalpostId, "after");
    repaired++;
  }

  console.log(
    `\n[repair-adjust-plan-empty-insert] signatures=${signatures.length} repaired=${repaired}${
      APPLY ? "" : " (dry run - pass --apply to mutate)"
    }`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("[repair-adjust-plan-empty-insert] crashed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
