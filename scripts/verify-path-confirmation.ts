/**
 * L1 Slice 2 — end-to-end check of the Path Confirmation gate + clarifying
 * dialogue + path revision, against the local DB (reuses the goal-interview
 * turn-taking engine + the existing Path Adjuster; the new piece is the
 * pre-acceptance applier applyPreAcceptancePathAdjustment()).
 *
 * Asserts the revision inserts/renumbers the draft WITHOUT completing any
 * goalpost or accepting the path, records a PathRevision with no triggerEval,
 * and getCurrentGoalpost serves goalpost 1 of the revised draft.
 *
 * Run: `bun run scripts/verify-path-confirmation.ts` (needs `bun run db:up`).
 * Cleans up the throwaway user. Exits non-zero on any failure.
 */
import { prisma } from "../lib/db";
import { getCurrentGoalpost } from "../lib/journey/intent/queries";
import { applyPreAcceptancePathAdjustment } from "../lib/journey/path/revision";
import type {
  PathAdjusterInput,
  PathAdjustment,
  InterviewTurn,
} from "../lib/services/types";
import type { PathAdjuster } from "../lib/services/interfaces/pathAdjuster.interface";
import type {
  OverviewGoalpost,
  PathConfirmationInput,
  PathConfirmationStep,
} from "../lib/services/pathConfirmation";
import type { PathConfirmationInterviewer } from "../lib/services/interfaces/pathConfirmationInterviewer.interface";

// Local deterministic doubles for the dialogue engine + adjuster. The
// interviewer asks one canned question, then completes with a concern
// synthesized from the learner's own words (backs the "concern reflects the
// learner's words" assertion). The adjuster inserts one remediation goalpost.
const PATHCONF_QUESTIONS = [
  "What feels off about this plan — is it aimed at the wrong level, missing something you need, or covering things you already know?",
];

class FakePathConfirmationInterviewer implements PathConfirmationInterviewer {
  async clarify(input: PathConfirmationInput): Promise<PathConfirmationStep> {
    const asked = input.transcript.filter((t) => t.role === "assistant").length;
    if (asked < PATHCONF_QUESTIONS.length) {
      return { kind: "question", question: PATHCONF_QUESTIONS[asked] };
    }
    const answers = input.transcript
      .filter((t) => t.role === "user")
      .map((t) => t.content.trim())
      .filter(Boolean);
    const concern =
      answers.length > 0
        ? `The learner says the proposed path is not quite right: "${answers.join(" ")}". Revise the overview to address this before they start.`
        : "The learner indicated the path is not quite right but did not elaborate; make a conservative, minimal adjustment toward the stated outcomes.";
    return { kind: "complete", concern };
  }
}

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
  payload: { prompt: `Do step ${order}.`, rubricFocus: ["application"] },
});

// Drive the reused turn-taking engine exactly as the client does: hold the
// transcript, re-send it each turn, append the assistant question, then a learner
// answer, until kind="complete". Returns the synthesized concern + turn count.
async function runDialogue(
  interviewer: PathConfirmationInterviewer,
  subject: { canonicalName: string; scopeNote: string },
  overview: OverviewGoalpost[],
  learnerAnswers: string[],
): Promise<{ concern: string; questionsAsked: number }> {
  let transcript: InterviewTurn[] = [];
  let questionsAsked = 0;
  let guard = 0;
  while (guard < 10) {
    guard++;
    const step = await interviewer.clarify({
      subject,
      outcome: [{ text: "I can do PCA", bloomLevel: "apply" }],
      overview,
      transcript,
    });
    if (step.kind === "complete") {
      return { concern: step.concern, questionsAsked };
    }
    questionsAsked++;
    const answer = learnerAnswers[questionsAsked - 1] ?? "It is too advanced.";
    transcript = [
      ...transcript,
      { role: "assistant", content: step.question },
      { role: "user", content: answer },
    ];
  }
  throw new Error("dialogue did not terminate");
}

async function main() {
  const user = await prisma.user.create({
    data: { email: `pathconf-verify-${Date.now()}@example.test`, name: "PathConf Verify" },
  });

  const intent = await prisma.learningIntent.create({
    data: {
      userId: user.id,
      rawText: "linear algebra for ML",
      // path_outlined: the draft path exists but is NOT accepted (pre-gate state).
      status: "path_outlined",
      subject: { create: { canonicalName: "Linear Algebra", scopeNote: "for ML" } },
      goal: { create: { motivation: "work", elaboration: "for a job" } },
      outcome: { create: { canDoStatements: [{ text: "I can do PCA", bloomLevel: "apply" }] } },
      assessment: { create: { competencies: [{ competency: "vectors", estimatedLevel: 2, confidence: 0.7 }] } },
    },
  });

  // A DRAFT path: not accepted, all goalposts pending (nothing in progress).
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

  // ---- 1. The reused dialogue engine terminates with a concern ----
  const interviewer = new FakePathConfirmationInterviewer();
  const overview: OverviewGoalpost[] = path.goalposts.map((g) => ({
    order: g.order,
    title: g.title,
    objective: g.objective,
    estimatedMinutes: g.estimatedMinutes,
  }));
  const { concern, questionsAsked } = await runDialogue(
    interviewer,
    { canonicalName: "Linear Algebra", scopeNote: "for ML" },
    overview,
    ["The first goalpost is stuff I already know."],
  );
  check("clarifying dialogue terminated with a non-empty concern", concern.length > 0);
  check("dialogue stayed short (>=1 question, capped)", questionsAsked >= 1 && questionsAsked <= 3);
  check("concern reflects the learner's words", concern.includes("already know"));

  // ---- 2. Concern -> existing Path Adjuster -> pre-acceptance revision ----
  const anchor = path.goalposts[0];
  const remaining = path.goalposts.slice(1);
  const adjuster = new FakePathAdjuster();
  const adjustment = await adjuster.adjust({
    mode: "confirmation_revision",
    subject: { canonicalName: "Linear Algebra", scopeNote: "for ML" },
    motivation: "work",
    outcome: [{ text: "I can do PCA", bloomLevel: "apply" }],
    assessment: [{ competency: "vectors", estimatedLevel: 2, confidence: 0.7 }],
    currentGoalpost: { order: anchor.order, title: anchor.title, objective: anchor.objective },
    triggerScores: { recall: 2, application: 2, conceptual: 2, transfer: 2, communication: 2, coverage: 2 },
    triggerRationale: `Before starting, the learner said: ${concern}`,
    remainingGoalposts: remaining.map((g) => ({
      order: g.order,
      title: g.title,
      objective: g.objective,
      estimatedMinutes: g.estimatedMinutes,
    })),
  });
  check("Path Adjuster produced an insertion (minimal edit)", adjustment.insertedGoalposts.length === 1);

  await prisma.$transaction((tx) =>
    applyPreAcceptancePathAdjustment(tx, { pathId: path.id, adjustment }),
  );

  // ---- 3. Pre-acceptance invariants ----
  const after = await prisma.goalpost.findMany({
    where: { pathId: path.id },
    orderBy: { order: "asc" },
  });
  check("no goalpost was marked complete (pre-acceptance, nothing started)",
    after.every((g) => g.status !== "complete"));

  const refreshedPath = await prisma.learningPath.findUnique({ where: { id: path.id } });
  check("path is still NOT accepted after a revision round", refreshedPath?.acceptedAt == null);
  check("path status still draft (gate not yet passed)", refreshedPath?.status === "draft");

  const orders = after.map((g) => g.order);
  check("no duplicate orders (unique constraint held)", new Set(orders).size === orders.length);
  check(
    "orders are contiguous 1..N",
    JSON.stringify([...orders].sort((a, b) => a - b)) ===
      JSON.stringify(Array.from({ length: after.length }, (_, i) => i + 1)),
  );
  check("total goalpost count grew by the inserted count", after.length === 3 + adjustment.insertedGoalposts.length);

  const revisions = await prisma.pathRevision.findMany({ where: { pathId: path.id } });
  check("exactly one PathRevision recorded for the round", revisions.length === 1);
  check("PathRevision has NO trigger evaluation (learner-confirmation trigger)",
    revisions[0]?.triggerEvalId == null);
  check("revisionCount tracks rounds (soft-cap signal) -> 1", refreshedPath?.revisionCount === 1);

  // getCurrentGoalpost serves goalpost 1 of the revised draft (the anchor a
  // subsequent "Looks good, start" would activate first).
  const served = await getCurrentGoalpost(intent.id);
  check("getCurrentGoalpost serves order 1 of the revised draft", served?.order === 1);

  // ---- 4. Soft cap: drive two more rounds, revisionCount reaches the cap (3) ----
  for (let round = 2; round <= 3; round++) {
    const gps = await prisma.goalpost.findMany({
      where: { pathId: path.id, status: { notIn: ["complete", "skipped"] } },
      orderBy: { order: "asc" },
    });
    const a = gps[0];
    const adj = await adjuster.adjust({
      mode: "confirmation_revision",
      subject: { canonicalName: "Linear Algebra", scopeNote: "for ML" },
      motivation: "work",
      outcome: [{ text: "I can do PCA", bloomLevel: "apply" }],
      assessment: [{ competency: "vectors", estimatedLevel: 2, confidence: 0.7 }],
      currentGoalpost: { order: a.order, title: a.title, objective: a.objective },
      triggerScores: { recall: 2, application: 2, conceptual: 2, transfer: 2, communication: 2, coverage: 2 },
      triggerRationale: "still not quite right",
      remainingGoalposts: gps.slice(1).map((g) => ({
        order: g.order,
        title: g.title,
        objective: g.objective,
        estimatedMinutes: g.estimatedMinutes,
      })),
    });
    await prisma.$transaction((tx) =>
      applyPreAcceptancePathAdjustment(tx, { pathId: path.id, adjustment: adj }),
    );
  }
  const capped = await prisma.learningPath.findUnique({ where: { id: path.id } });
  check("revisionCount reached the soft cap (3) after three rounds", capped?.revisionCount === 3);
  const stillUnaccepted = capped?.acceptedAt == null;
  check("learner is never trapped: path still startable (unaccepted) at the cap", stillUnaccepted);

  // Orders remain sound after repeated rounds.
  const finalGps = await prisma.goalpost.findMany({
    where: { pathId: path.id },
    orderBy: { order: "asc" },
  });
  const finalOrders = finalGps.map((g) => g.order);
  check(
    "orders still contiguous 1..N after three rounds",
    JSON.stringify([...finalOrders].sort((a, b) => a - b)) ===
      JSON.stringify(Array.from({ length: finalGps.length }, (_, i) => i + 1)),
  );

  await prisma.user.delete({ where: { id: user.id } });

  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error("verify-path-confirmation crashed:", e);
  process.exit(1);
});
