/**
 * Persistence + orchestration for the knowledge-probe resume slice. Mirrors
 * ensureLessonContent's idempotent generate-once contract (lessonGeneration.ts)
 * and researchBundle.ts's race-safe create-then-claim (a loser catches the
 * unique-constraint violation and re-reads the winner's row, converging on the
 * DB instead of application-level locking).
 *
 * ProbeState is a NEW table rather than reusing KnowledgeAssessment's Json
 * columns — see the model comment in schema.prisma for why.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getServices } from "@/lib/services";
import type { CanDoStatement, ProbeQuestion } from "@/lib/services/types";
import {
  makeProbeGenerationState,
  isProbeGenerationState,
  type ProbeGenerationState,
  type ProbeRunStatus,
} from "./probeGenerationState";

const UNIQUE_VIOLATION = "P2002";

/** The combined resume payload the poll action returns to the client. */
export type ProbeResumeState = {
  status: ProbeRunStatus;
  questions: ProbeQuestion[] | null;
  answers: Record<string, string>;
  error: string | null;
};

/** Best-effort write of the generation-state record; never throws. */
async function writeProbeGenerationState(
  intentId: string,
  state: ProbeGenerationState,
): Promise<void> {
  try {
    await prisma.probeState.update({
      where: { intentId },
      data: { generationState: state as unknown as Prisma.InputJsonValue },
    });
  } catch {
    // Progress telemetry is non-critical; never break generation over a write.
  }
}

/**
 * Read the resume payload for a journey. Returns null when no probe row
 * exists yet (before the first kickoff call — the client should still poll,
 * treating null as "not started").
 */
export async function readProbeState(
  intentId: string,
): Promise<ProbeResumeState | null> {
  const row = await prisma.probeState.findUnique({ where: { intentId } });
  if (!row) return null;
  const answers =
    (row.answers as unknown as Record<string, string> | null) ?? {};

  if (row.questionsGeneratedAt) {
    return {
      status: "ready",
      questions: (row.questions as unknown as ProbeQuestion[] | null) ?? [],
      answers,
      error: null,
    };
  }
  const state = row.generationState as unknown;
  if (isProbeGenerationState(state) && state.status === "failed") {
    return { status: "failed", questions: null, answers, error: state.error };
  }
  return { status: "running", questions: null, answers, error: null };
}

/**
 * Claim the right to run generation for this intent, race-safe:
 *   - no row yet -> create it (status running); a concurrent loser catches the
 *     unique-constraint violation and re-reads the winner's row instead of a
 *     blind retry (same convergence pattern as researchBundle's ensureBundle).
 *   - row exists and is already ready or running -> false, someone else owns it.
 *   - row exists and is failed/unstarted -> reclaim it for a retry. This
 *     window accepts a benign, rare double-generation on a concurrent retry —
 *     the same risk tolerance ensureLessonContent already carries; there is no
 *     atomic reclaim here on purpose, to avoid Json-path filter machinery for
 *     an edge case this codebase does not otherwise guard against.
 */
async function claimProbeGeneration(intentId: string): Promise<boolean> {
  let row = await prisma.probeState.findUnique({ where: { intentId } });
  if (!row) {
    try {
      row = await prisma.probeState.create({
        data: {
          intentId,
          generationState: makeProbeGenerationState(
            "running",
          ) as unknown as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (err) {
      if (
        !(
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === UNIQUE_VIOLATION
        )
      ) {
        throw err;
      }
      row = await prisma.probeState.findUnique({ where: { intentId } });
      if (!row) throw err;
    }
  }

  if (row.questionsGeneratedAt) return false;
  const state = row.generationState as unknown;
  if (isProbeGenerationState(state) && state.status === "running") return false;

  await prisma.probeState.update({
    where: { intentId },
    data: {
      generationState: makeProbeGenerationState(
        "running",
      ) as unknown as Prisma.InputJsonValue,
    },
  });
  return true;
}

/**
 * Generate and persist the probe questions for a journey, if not already
 * generated or in flight. Idempotent — safe to call on every mount of the
 * probe wait screen, mirroring prepareGoalpostContentAction's contract.
 */
export async function ensureProbeQuestions(intentId: string): Promise<void> {
  const claimed = await claimProbeGeneration(intentId);
  if (!claimed) return;

  const subject = await prisma.subject.findUnique({ where: { intentId } });
  const outcome = await prisma.expectedOutcome.findUnique({ where: { intentId } });
  if (!subject || !outcome) {
    await writeProbeGenerationState(
      intentId,
      makeProbeGenerationState("failed", {
        error: "This journey has no subject or outcome to probe against.",
      }),
    );
    return;
  }

  try {
    const services = getServices();
    const canDo = outcome.canDoStatements as unknown as CanDoStatement[];
    const questions = await services.knowledgeProbe.questions(
      { canonicalName: subject.canonicalName, scopeNote: subject.scopeNote },
      canDo,
    );
    await prisma.probeState.update({
      where: { intentId },
      data: {
        questions: questions as unknown as Prisma.InputJsonValue,
        questionsGeneratedAt: new Date(),
        generationState: makeProbeGenerationState(
          "ready",
        ) as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[probe-generation] question generation failed for intent "${intentId}": ` +
        `${(err as Error).message}`,
    );
    await writeProbeGenerationState(
      intentId,
      makeProbeGenerationState("failed", { error: (err as Error).message }),
    );
  }
}

/**
 * Persist one answer incrementally, addressed by the question's position in
 * the generated array (the client's index into `questions`) but stored keyed
 * by the question's own id — the same key submitProbeAction's scoring already
 * uses, so a resumed learner's saved answers line up with the eventual score
 * call without any re-keying. No-ops if questions are not generated yet or
 * the index is out of range.
 */
export async function saveProbeAnswer(
  intentId: string,
  questionIndex: number,
  answer: string,
): Promise<void> {
  const row = await prisma.probeState.findUnique({ where: { intentId } });
  if (!row || !row.questionsGeneratedAt) return;
  const questions = (row.questions as unknown as ProbeQuestion[] | null) ?? [];
  const question = questions[questionIndex];
  if (!question) return;

  const existing =
    (row.answers as unknown as Record<string, string> | null) ?? {};
  const next = { ...existing, [question.id]: answer };
  await prisma.probeState.update({
    where: { intentId },
    data: { answers: next as unknown as Prisma.InputJsonValue },
  });
}
