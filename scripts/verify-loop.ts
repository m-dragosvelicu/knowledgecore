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
import { getCurrentGoalpost } from "../lib/journey/intent/queries";
import {
  applyPathAdjustment,
  applyPreAcceptancePathAdjustment,
} from "../lib/journey/path/revision";
import type { PathAdjusterInput, PathAdjustment } from "../lib/services/types";
import type { PathAdjuster } from "../lib/services/interfaces/pathAdjuster.interface";

// Local deterministic adjuster double. Mirrors the deleted MockPathAdjuster:
// inserts ONE remediation goalpost at currentOrder+1, titled "Shore up: <title>",
// keeping all remaining goalposts intact (minimal-edit). The DB assertions below
// depend on exactly: one insertion, title starts with "Shore up".
class FakePathAdjuster implements PathAdjuster {
  async adjust(input: PathAdjusterInput): Promise<PathAdjustment> {
    const insertOrder = input.currentGoalpost.order + 1;
    return {
      insertedGoalposts: [
        {
          order: insertOrder,
          title: `Shore up: ${input.currentGoalpost.title}`,
          objective: `Revisit "${input.currentGoalpost.objective}" before moving on.`,
          estimatedMinutes: 30,
          steps: [
            { order: 1, type: "information", payload: { content: "Rebuild the foundation.", sourceIds: [] } },
            {
              order: 2,
              type: "experience_socratic",
              payload: { prompt: "Explain the core idea in your own words.", rubricFocus: ["conceptual", "communication"] },
            },
          ],
        },
      ],
      removedOrders: [],
      modifiedGoalposts: [],
      rationale: `Added a short refresher on "${input.currentGoalpost.title}".`,
    };
  }
}

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
  const adjuster = new FakePathAdjuster();
  const adjustment = await adjuster.adjust({
    mode: "remediation",
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

  const after = await prisma.goalpost.findMany({
    where: { pathId: path.id },
    orderBy: { order: "asc" },
  });

  const completedG1 = after.find((g) => g.id === g1.id)!;
  check(
    "current goalpost (order 1) is superseded, not complete (founder ruling 2026-07-17)",
    completedG1.status === "superseded",
  );

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

  await prisma.user.delete({ where: { id: user.id } });

  await scenarioEmptyInsertRefused();
  await scenarioPreAcceptanceZeroInsertAllowed();

  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
  process.exit(failures ? 1 : 0);
}

// PM ruling 2026-07-17: the >=1-insert requirement is remediation-only.
// applyPreAcceptancePathAdjustment (pre-acceptance path-confirmation revision)
// must keep accepting a zero-insert PathAdjustment — e.g. a pure "drop this
// goalpost" edit — without throwing, since there is no "current goalpost" to
// complete in that flow.
async function scenarioPreAcceptanceZeroInsertAllowed() {
  const user = await prisma.user.create({
    data: { email: `loop-verify-preaccept-${Date.now()}@example.test`, name: "Loop Verify Preaccept" },
  });

  const intent = await prisma.learningIntent.create({
    data: {
      userId: user.id,
      rawText: "verify pre-acceptance zero-insert is allowed",
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
      status: "draft",
      goalposts: {
        create: [1, 2, 3].map((n) => ({
          order: n,
          title: `Goalpost ${n}`,
          objective: `Objective ${n}.`,
          estimatedMinutes: 45,
          status: "pending",
          steps: { create: [infoStep(1), expStep(2)] },
        })),
      },
    },
    include: { goalposts: { orderBy: { order: "asc" } } },
  });

  // Pure removal, no insertion: "I already know goalpost 3, drop it."
  const zeroInsertAdjustment: PathAdjustment = {
    insertedGoalposts: [],
    removedOrders: [3],
    modifiedGoalposts: [],
    rationale: "I have removed the step you already know.",
  };

  let threw = false;
  try {
    await prisma.$transaction((tx) =>
      applyPreAcceptancePathAdjustment(tx, { pathId: path.id, adjustment: zeroInsertAdjustment }),
    );
  } catch {
    threw = true;
  }
  check("applyPreAcceptancePathAdjustment does NOT throw on insertedGoalposts=[]", !threw);

  const after = await prisma.goalpost.findMany({
    where: { pathId: path.id },
    orderBy: { order: "asc" },
  });
  check("no goalpost was marked complete (pre-acceptance, nothing started)",
    after.every((g) => g.status !== "complete"));
  check("goalpost 3 is skipped (removed)", after.find((g) => g.title === "Goalpost 3")?.status === "skipped");
  const orders = after.map((g) => g.order);
  check("no duplicate orders after zero-insert removal", new Set(orders).size === orders.length);

  const revisions = await prisma.pathRevision.findMany({ where: { pathId: path.id } });
  check("one PathRevision recorded for the zero-insert round", revisions.length === 1);

  await prisma.user.delete({ where: { id: user.id } });
}

// Regression coverage for the 2026-07-17 bug: an adjust_plan response with
// insertedGoalposts=[] must NOT silently stamp the current goalpost complete
// (that would advance the learner past a goalpost they never passed). This
// bypasses the LLM/schema layer and calls applyPathAdjustment directly with a
// hand-built empty-insert PathAdjustment, exercising the defense-in-depth
// guard in lib/journey/path/revision.ts on its own.
async function scenarioEmptyInsertRefused() {
  const user = await prisma.user.create({
    data: { email: `loop-verify-empty-${Date.now()}@example.test`, name: "Loop Verify Empty" },
  });

  const intent = await prisma.learningIntent.create({
    data: {
      userId: user.id,
      rawText: "verify the empty-insert guard",
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
        create: [1, 2].map((n) => ({
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

  const emptyInsertAdjustment: PathAdjustment = {
    insertedGoalposts: [],
    removedOrders: [],
    modifiedGoalposts: [],
    rationale: "Malformed adjustment: no remediation goalpost supplied.",
  };

  let threw = false;
  try {
    await prisma.$transaction((tx) =>
      applyPathAdjustment(tx, {
        pathId: path.id,
        currentGoalpostId: g1.id,
        currentOrder: 1,
        adjustment: emptyInsertAdjustment,
        triggerEvalId: evaluation.id,
      }),
    );
  } catch {
    threw = true;
  }
  check("applyPathAdjustment throws on insertedGoalposts=[]", threw);

  const g1After = await prisma.goalpost.findUnique({ where: { id: g1.id } });
  check(
    "current goalpost is NOT marked complete (transaction rolled back)",
    g1After?.status === "in_progress",
  );

  const revisions = await prisma.pathRevision.findMany({ where: { pathId: path.id } });
  check("no PathRevision recorded (transaction rolled back)", revisions.length === 0);

  await prisma.user.delete({ where: { id: user.id } });
}

main().catch(async (e) => {
  console.error("verify-loop crashed:", e);
  process.exit(1);
});
