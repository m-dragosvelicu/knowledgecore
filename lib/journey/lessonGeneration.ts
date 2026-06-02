/**
 * L1 — Two-Phase Visual Lesson Pipeline (Slice 1: Foundation).
 *
 * Lazy per-goalpost lesson-content generation. Call A (the PathOutliner) builds
 * the path STRUCTURE up front and seeds each information step; this module
 * authors the real, PROFILE-ADAPTED information content WHEN THE LEARNER ENTERS
 * the goalpost (or pre-generates it on advance), then persists it.
 *
 * The content is now produced by the CODE-OWNED ORCHESTRATOR
 * (lib/journey/lessonOrchestration.ts), a two-phase pipeline: Phase 1 authors an
 * ordered LessonDoc of prose + visual SPECS (no drawing); Phase 2 resolves each
 * visual spec in parallel with retry-then-drop. The orchestrator runs behind
 * PORTS (Author / VisualWorkers) wired in lib/services/index.ts.
 *
 * This module is the SEAM the goalpost page (entry) and the pre-generation hook
 * (advance) both call. Its signature is UNCHANGED so prepareGoalpostContentAction
 * and doAdvance are untouched. As the orchestrator progresses it writes a
 * GENERATION-STATE record (the GettingReady screen polls it via
 * readLessonGenerationState); on TERMINAL failure it records `status: "failed"`
 * instead of silently swallowing — closing the old infinite-retry loop.
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

/**
 * Shape we read off / write to the information step's JSON payload. It now
 * carries the new LessonDoc fields ({ sections, contentGeneratedAt }) plus the
 * reserved `generationState` key the client polls. Legacy fields (content,
 * visuals, supportLevel, workedExamples) may still be present on older rows and
 * are read by the renderer's back-compat path; this module writes the new shape.
 */
type InfoPayload = Partial<LessonDoc> & {
  /** Legacy single-call fields (older rows / back-compat read path). */
  content?: string;
  sourceIds?: string[];
  supportLevel?: string;
  workedExamples?: number;
  visuals?: unknown[];
  /** The §8 progress record the GettingReady screen polls. */
  generationState?: LessonGenerationState;
};

/**
 * Flatten an information-step payload into the lesson's prose text, for callers
 * that need the markdown body (e.g. the checkpoint evaluator's `informationContent`
 * input). Handles BOTH shapes: the new LessonDoc (concatenate prose blocks) and
 * the legacy single-call `content` string. Returns "" when neither is present.
 */
export function lessonContentText(payload: unknown): string {
  if (isLessonDoc(payload)) {
    const parts: string[] = [];
    for (const section of payload.sections) {
      for (const block of section.blocks) {
        if (isProseBlock(block)) parts.push(block.md);
      }
    }
    return parts.join("\n\n");
  }
  const legacy = (payload as { content?: string } | null)?.content;
  return typeof legacy === "string" ? legacy : "";
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
 * The generation-state record the GettingReady screen polls (~1s). Returns the
 * record for the goalpost's information step, or null when there is none yet
 * (e.g. before the first generation attempt). Read-only; safe to call repeatedly.
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
  // A generated lesson is implicitly "ready" even if no explicit record was kept
  // (e.g. a pre-generation that finished before any poll observed it).
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
 * Generate (the two-phase pipeline) and persist the information content for one
 * goalpost against the freshest journey profile, if not already generated.
 * Idempotent: a goalpost whose content is already marked generated is left
 * untouched. Returns true if it generated content on this call, false if it was
 * already ready, there was nothing to do, OR generation failed terminally (in
 * which case a `status: "failed"` generation-state record is persisted so the
 * GettingReady screen can show a real error + Try again rather than loop).
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

    // ASSEMBLE persisted: write the COMPLETE LessonDoc + a `ready` state in one
    // update. The reveal invariant holds — the page only ever sees a complete doc
    // (contentGeneratedAt set) or the progress/error screen, never a partial doc.
    const nextPayload: InfoPayload = {
      ...payload,
      sections: doc.sections,
      contentGeneratedAt: doc.contentGeneratedAt,
      sourceIds: payload.sourceIds ?? [],
      generationState: makeGenerationState("ready"),
      // Drop the legacy single-call fields so the renderer takes the LessonDoc
      // path; older rows that never regenerate keep theirs untouched.
      content: undefined,
      visuals: undefined,
    };
    await prisma.step.update({
      where: { id: infoStep.id },
      data: { payload: nextPayload as object },
    });
    return true;
  } catch (err) {
    // No silent swallow. Record a TERMINAL failure state so GettingReady (Slice 4)
    // shows a real error + Try again instead of router.refresh()-looping forever.
    // contentGeneratedAt is intentionally NOT set, so the goalpost stays "not
    // ready" and a retry re-enters this path cleanly.
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
