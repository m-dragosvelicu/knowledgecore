/**
 * L1 Slice 1 — lazy per-goalpost lesson-content orchestration (Call B).
 *
 * Call A (the PathOutliner) builds the path STRUCTURE up front and seeds each
 * information step with placeholder/structure content. Call B (here) authors the
 * real, PROFILE-ADAPTED information content WHEN THE LEARNER ENTERS the goalpost,
 * then persists it. The information-step payload carries a `contentGeneratedAt`
 * marker so a goalpost is generated at most once (idempotent) and we can tell a
 * freshly-generated lesson from the Call-A seed.
 *
 * This module is the seam the goalpost page (entry) and the pre-generation hook
 * (advance) both call. It reads the freshest journey profile via profileStore so
 * the content reflects the latest mastery evidence.
 */

import { StepType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getLessonContentGenerator } from "@/lib/services";
import { readOrCreateProfile } from "./profileStore";
import type { Competency } from "@/lib/services/types";
import type { VisualNeed } from "@/lib/services/visualMedia";

/** Shape we read off / write to the information step's JSON payload. */
type InfoPayload = {
  content?: string;
  sourceIds?: string[];
  contentGeneratedAt?: string;
  supportLevel?: string;
  workedExamples?: number;
  /**
   * L1 Slice 4 — the visual NEEDS the generator emitted for this lesson (each
   * tagged with a structured visualKind). Stored raw (UNRESOLVED) here; the gate
   * resolves them at render time (SVG sanitized on its dedicated path, image /
   * video sourced server-side). Kept as plain JSON to match the payload pattern.
   */
  visuals?: VisualNeed[];
};

/** True if the goalpost's information step already has Call-B-generated content. */
export async function isLessonContentReady(goalpostId: string): Promise<boolean> {
  const info = await prisma.step.findFirst({
    where: { goalpostId, type: StepType.information },
    select: { payload: true },
  });
  if (!info) return true; // no information step → nothing to generate; treat as ready
  const payload = (info.payload as InfoPayload | null) ?? {};
  return Boolean(payload.contentGeneratedAt);
}

/**
 * Generate (Call B) and persist the information content for one goalpost against
 * the freshest journey profile, if not already generated. Idempotent: a goalpost
 * whose content is already marked generated is left untouched. Returns true if it
 * generated content on this call, false if it was already ready or there was
 * nothing to do.
 *
 * Best-effort by contract at the call site: a generation failure must not break
 * the journey. On failure we leave the Call-A seed content in place (the lesson
 * still renders) and rethrow only if the caller wants to surface a loading retry;
 * here we swallow-and-keep so the spine is resilient.
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
  if (payload.contentGeneratedAt) return false; // already generated → idempotent

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

  try {
    const generator = getLessonContentGenerator();
    const lesson = await generator.generate({
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
    });

    const nextPayload: InfoPayload = {
      ...payload,
      content: lesson.content,
      sourceIds: payload.sourceIds ?? [],
      contentGeneratedAt: new Date().toISOString(),
      supportLevel: lesson.supportLevel,
      workedExamples: lesson.workedExamples,
      visuals: lesson.visuals ?? [],
    };
    await prisma.step.update({
      where: { id: infoStep.id },
      data: { payload: nextPayload as object },
    });
    return true;
  } catch (err) {
    // Resilient spine: keep the Call-A seed content so the lesson still renders.
    // eslint-disable-next-line no-console
    console.warn(
      `[lesson-generation] Call B failed for goalpost "${goalpost.title}"; ` +
        `keeping Call-A seed content. ${(err as Error).message}`,
    );
    return false;
  }
}
