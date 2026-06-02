/**
 * Lazy per-goalpost lesson-content generation: the seam the goalpost page (entry)
 * and the pre-generation hook (advance) both call. Runs the two-phase orchestrator
 * and persists the assembled LessonDoc, writing a generation-state record the
 * GettingReady screen polls; a terminal failure is recorded as `status: "failed"`
 * rather than swallowed, so the client shows an error instead of looping.
 */

import { StepType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getLessonOrchestratorPorts } from "@/lib/services";
import { readOrCreateProfile } from "./profileStore";
import type { Competency } from "@/lib/services/types";
import { runLessonPipeline } from "./lessonOrchestration";
import type { LessonDoc } from "@/lib/services/lessonDoc";
import { isLessonDoc, isProseBlock } from "@/lib/services/lessonDoc";
import {
  makeGenerationState,
  type LessonGenerationState,
} from "./lessonGenerationState";

/** The information step's JSON payload: a LessonDoc plus the polled progress record. */
type InfoPayload = Partial<LessonDoc> & {
  sourceIds?: string[];
  generationState?: LessonGenerationState;
};

/** Concatenated prose of a LessonDoc payload (checkpoint evaluator input); "" if none. */
export function lessonContentText(payload: unknown): string {
  if (!isLessonDoc(payload)) return "";
  const parts: string[] = [];
  for (const section of payload.sections) {
    for (const block of section.blocks) {
      if (isProseBlock(block)) parts.push(block.md);
    }
  }
  return parts.join("\n\n");
}

/** True if the goalpost's information step already has generated content. */
export async function isLessonContentReady(goalpostId: string): Promise<boolean> {
  const info = await prisma.step.findFirst({
    where: { goalpostId, type: StepType.information },
    select: { payload: true },
  });
  if (!info) return true; // no information step -> nothing to generate; ready
  const payload = (info.payload as InfoPayload | null) ?? {};
  return Boolean(payload.contentGeneratedAt);
}

/**
 * The generation-state record the GettingReady screen polls. Returns null when
 * there is none yet (before the first generation attempt).
 */
export async function readLessonGenerationState(
  goalpostId: string,
): Promise<LessonGenerationState | null> {
  const info = await prisma.step.findFirst({
    where: { goalpostId, type: StepType.information },
    select: { payload: true },
  });
  if (!info) return null;
  const payload = (info.payload as InfoPayload | null) ?? {};
  // A generated lesson is implicitly "ready" even if a pre-generation finished
  // before any poll observed it (so no explicit record was kept).
  if (payload.contentGeneratedAt && !payload.generationState) {
    return makeGenerationState("ready");
  }
  return payload.generationState ?? null;
}

/** Persist a generation-state record onto the information step (best-effort). */
async function writeGenerationState(
  infoStepId: string,
  basePayload: InfoPayload,
  state: LessonGenerationState,
): Promise<void> {
  try {
    await prisma.step.update({
      where: { id: infoStepId },
      data: { payload: { ...basePayload, generationState: state } as object },
    });
  } catch {
    // Progress telemetry is non-critical; never break generation over a write.
  }
}

/**
 * Generate and persist the information content for one goalpost against the
 * freshest journey profile, if not already generated. Idempotent. Returns true
 * when it generated on this call, false if already ready, nothing to do, OR
 * generation failed terminally (in which case a `status: "failed"` state is
 * persisted so the GettingReady screen shows an error + Try again, not a loop).
 */
export async function ensureLessonContent(
  intentId: string,
  userId: string,
  goalpostId: string,
): Promise<boolean> {
  const goalpost = await prisma.goalpost.findUnique({
    where: { id: goalpostId },
    include: {
      steps: { orderBy: { order: "asc" } },
      path: {
        select: {
          intent: {
            select: {
              subject: true,
              outcome: true,
              assessment: true,
            },
          },
        },
      },
    },
  });
  if (!goalpost) return false;

  const infoStep = goalpost.steps.find((s) => s.type === StepType.information);
  if (!infoStep) return false;
  const payload = (infoStep.payload as InfoPayload | null) ?? {};
  if (payload.contentGeneratedAt) return false; // already generated -> idempotent

  const expStep = goalpost.steps.find((s) => s.type !== StepType.information);
  const experiencePrompt =
    (expStep?.payload as { prompt?: string } | null)?.prompt ?? "";

  const intent = goalpost.path.intent;
  const subject = intent.subject
    ? {
        canonicalName: intent.subject.canonicalName,
        scopeNote: intent.subject.scopeNote,
      }
    : { canonicalName: goalpost.title, scopeNote: goalpost.objective };
  const endAchievement = intent.outcome?.successCriterion ?? "";
  const assessment = (intent.assessment?.competencies ??
    []) as unknown as Competency[];

  const profile = await readOrCreateProfile(intentId, userId);

  // The progress sink persists the orchestrator's current stage onto the info
  // step so the client poll (readLessonGenerationState) sees honest live status.
  const onProgress = (state: LessonGenerationState) =>
    writeGenerationState(infoStep.id, payload, state);

  try {
    const ports = getLessonOrchestratorPorts();
    const doc = await runLessonPipeline(
      {
        conceptKey: goalpost.id,
        subject,
        goalpost: {
          order: goalpost.order,
          title: goalpost.title,
          objective: goalpost.objective,
        },
        experiencePrompt,
        endAchievement,
        assessment,
        profile,
      },
      { ...ports, onProgress },
    );

    // Write the COMPLETE LessonDoc + a `ready` state in one update. The reveal
    // invariant holds: the page only ever sees a complete doc (contentGeneratedAt
    // set) or the progress/error screen, never a partial doc.
    const nextPayload: InfoPayload = {
      ...payload,
      sections: doc.sections,
      contentGeneratedAt: doc.contentGeneratedAt,
      sourceIds: payload.sourceIds ?? [],
      generationState: makeGenerationState("ready"),
    };
    await prisma.step.update({
      where: { id: infoStep.id },
      data: { payload: nextPayload as object },
    });
    return true;
  } catch (err) {
    // No silent swallow: record a terminal failure (contentGeneratedAt stays
    // unset, so the goalpost is still "not ready" and a retry re-enters cleanly).
    // eslint-disable-next-line no-console
    console.warn(
      `[lesson-generation] pipeline failed for goalpost "${goalpost.title}": ` +
        `${(err as Error).message}`,
    );
    await writeGenerationState(
      infoStep.id,
      payload,
      makeGenerationState("failed", {
        label: "We could not prepare this goalpost just now.",
      }),
    );
    return false;
  }
}
