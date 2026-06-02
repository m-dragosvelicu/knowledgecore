/**
 * Purge ALL journey data on the LOCAL dev DB, keeping User + Session (auth) intact.
 *
 * Deleting every LearningIntent cascades to its whole graph (Subject / Goal /
 * Outcome / Assessment / Path / Goalpost / Step / CheckpointEvaluation /
 * LearnerProfile / Snapshot). LlmCall.evaluationId is onDelete:SetNull (NOT
 * cascade), so journey-scoped LlmCall rows would be orphaned, not removed — we
 * delete those (and PathRevision rows) explicitly first, in FK-safe order.
 *
 * Run: `bun run scripts/purge-journeys.ts`
 */
import { prisma } from "@/lib/db";

async function counts() {
  const [
    users,
    sessions,
    intents,
    paths,
    goalposts,
    steps,
    evaluations,
    profiles,
    snapshots,
    revisions,
    llmCalls,
    llmCallsScoped,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.session.count(),
    prisma.learningIntent.count(),
    prisma.learningPath.count(),
    prisma.goalpost.count(),
    prisma.step.count(),
    prisma.checkpointEvaluation.count(),
    prisma.learnerProfile.count(),
    prisma.learnerProfileSnapshot.count(),
    prisma.pathRevision.count(),
    prisma.llmCall.count(),
    prisma.llmCall.count({ where: { evaluationId: { not: null } } }),
  ]);
  return {
    users,
    sessions,
    intents,
    paths,
    goalposts,
    steps,
    evaluations,
    profiles,
    snapshots,
    revisions,
    llmCalls,
    llmCallsScoped,
  };
}

async function main() {
  const before = await counts();
  console.log("BEFORE:", JSON.stringify(before, null, 2));

  // FK-safe order: rows pointing INTO the journey graph via SetNull/optional FKs
  // first (they would otherwise be orphaned), then the intents (the rest cascades).
  const revisions = await prisma.pathRevision.deleteMany({});
  const scopedCalls = await prisma.llmCall.deleteMany({
    where: { evaluationId: { not: null } },
  });
  const intents = await prisma.learningIntent.deleteMany({});

  console.log(
    `Deleted: ${intents.count} intents (cascade), ` +
      `${revisions.count} path revisions, ${scopedCalls.count} journey-scoped LlmCalls.`,
  );

  const after = await counts();
  console.log("AFTER:", JSON.stringify(after, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
