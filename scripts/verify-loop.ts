/**
 * End-to-end check of the adjust_plan path-revision mechanics against the local
 * DB, exercising the SAME applyPathAdjustment() the server action uses. Seeds a
 * throwaway journey, runs the live MockPathAdjuster through the transaction, and
 * asserts the DB invariants (order integrity, renumber, revision, served goalpost).
 *
 * Run: `bun run scripts/verify-loop.ts` (needs the local Postgres up: bun run db:up).
 * Cleans up the throwaway user at the end. Exits non-zero on any failed assertion.
 */
import { prisma } from "../lib/db";
import { getCurrentGoalpost } from "../lib/journey/state";
import { applyPathAdjustment } from "../lib/journey/pathRevision";
import { MockPathAdjuster } from "../lib/services/mock/mockPathAdjuster";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} | ${name}`);
  if (!cond) failures++;
}

const infoStep = (order: number) => ({
  order,
  type: "information" as const,
  payload: { content: `Info ${order}`, sourceIds: [] },
});
const expStep = (order: number) => ({
  order,
  type: "experience_applied_problem" as const,
  payload: { prompt: `Do the thing for step ${order} with concrete numbers.`, rubricFocus: ["application"] },
});

async function main() {
  const user = await prisma.user.create({
    data: { email: `loop-verify-${Date.now()}@example.test`, name: "Loop Verify" },
  });

  const intent = await prisma.learningIntent.create({
    data: {
      userId: user.id,
      rawText: "verify the remediation loop",
      status: "in_progress",
      subject: { create: { canonicalName: "Test Subject", scopeNote: "narrow" } },
      goal: { create: { motivation: "work", elaboration: "testing" } },
      outcome: { create: { canDoStatements: [{ text: "I can do X", bloomLevel: "apply" }] } },
      assessment: { create: { competencies: [{ competency: "x", estimatedLevel: 1, confidence: 0.8 }] } },
    },
  });

  const path = await prisma.learningPath.create({
    data: {
      intentId: intent.id,
      status: "accepted",
      acceptedAt: new Date(),
      goalposts: {
        create: [1, 2, 3].map((n) => ({
          order: n,
          title: `Goalpost ${n}`,
          objective: `Objective ${n}.`,
          estimatedMinutes: 45,
          status: n === 1 ? "in_progress" : "pending",
          steps: { create: [infoStep(1), expStep(2)] },
        })),
      },
    },
    include: { goalposts: { orderBy: { order: "asc" } } },
  });

  const g1 = path.goalposts.find((g) => g.order === 1)!;

  // A failing checkpoint on goalpost 1 triggered adjust_plan.
  const evaluation = await prisma.checkpointEvaluation.create({
    data: {
      goalpostId: g1.id,
      attempt: 3,
      scores: { recall: 1, application: 1, conceptual: 1, transfer: 1, communication: 2, coverage: 1 },
      evidence: [],
      decision: "adjust_plan",
      rationale: "You are missing a prerequisite.",
    },
  });

  // Run the REAL adjuster + the REAL transaction helper the action uses.
  const adjuster = new MockPathAdjuster();
  const adjustment = await adjuster.adjust({
    subject: { canonicalName: "Test Subject", scopeNote: "narrow" },
    motivation: "work",
    outcome: [{ text: "I can do X", bloomLevel: "apply" }],
    assessment: [{ competency: "x", estimatedLevel: 1, confidence: 0.8 }],
    currentGoalpost: { order: 1, title: "Goalpost 1", objective: "Objective 1." },
    triggerScores: { recall: 1, application: 1, conceptual: 1, transfer: 1, communication: 2, coverage: 1 },
    triggerRationale: "You are missing a prerequisite.",
    remainingGoalposts: [
      { order: 2, title: "Goalpost 2", objective: "Objective 2.", estimatedMinutes: 45 },
      { order: 3, title: "Goalpost 3", objective: "Objective 3.", estimatedMinutes: 45 },
    ],
  });

  await prisma.$transaction((tx) =>
    applyPathAdjustment(tx, {
      pathId: path.id,
      currentGoalpostId: g1.id,
      currentOrder: 1,
      adjustment,
      triggerEvalId: evaluation.id,
    }),
  );

  // ---- assertions ----
  const after = await prisma.goalpost.findMany({
    where: { pathId: path.id },
    orderBy: { order: "asc" },
  });

  const completedG1 = after.find((g) => g.id === g1.id)!;
  check("current goalpost (order 1) is complete", completedG1.status === "complete");

  const inserted = adjustment.insertedGoalposts.length;
  check("one remediation goalpost was inserted by the mock", inserted === 1);

  const orders = after.map((g) => g.order);
  const uniqueOrders = new Set(orders);
  check("no duplicate orders (unique constraint held)", uniqueOrders.size === orders.length);
  check(
    "orders are contiguous 1..N",
    JSON.stringify([...orders].sort((a, b) => a - b)) ===
      JSON.stringify(Array.from({ length: after.length }, (_, i) => i + 1)),
  );
  check("total goalpost count grew by inserted count", after.length === 3 + inserted);

  // The inserted remediation should now sit at order 2, and the old order-2/3
  // goalposts renumbered to 3/4.
  const atOrder2 = after.find((g) => g.order === 2)!;
  check("order 2 is the inserted remediation goalpost", atOrder2.title.startsWith("Shore up"));
  const oldG2 = after.find((g) => g.title === "Goalpost 2")!;
  const oldG3 = after.find((g) => g.title === "Goalpost 3")!;
  check("old Goalpost 2 renumbered to 3", oldG2.order === 3);
  check("old Goalpost 3 renumbered to 4", oldG3.order === 4);

  const served = await getCurrentGoalpost(intent.id);
  check("getCurrentGoalpost serves the inserted remediation (order 2)", served?.id === atOrder2.id);

  const revisions = await prisma.pathRevision.findMany({ where: { pathId: path.id } });
  check("exactly one PathRevision recorded", revisions.length === 1);
  check("PathRevision linked to the trigger evaluation", revisions[0]?.triggerEvalId === evaluation.id);
  const refreshedPath = await prisma.learningPath.findUnique({ where: { id: path.id } });
  check("revisionCount incremented to 1", refreshedPath?.revisionCount === 1);

  // Walk the rest of the path to completion (advance each served goalpost).
  let guard = 0;
  let cur = await getCurrentGoalpost(intent.id);
  while (cur && guard < 10) {
    await prisma.goalpost.update({ where: { id: cur.id }, data: { status: "complete" } });
    cur = await getCurrentGoalpost(intent.id);
    guard++;
  }
  check("journey walks to no-remaining-goalpost (completable)", cur === null && guard < 10);

  // cleanup
  await prisma.user.delete({ where: { id: user.id } });

  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error("verify-loop crashed:", e);
  process.exit(1);
});
