import { redirect } from "next/navigation";
import { getCurrentSession, isAnonymousSession } from "@/lib/auth";
import { GATE_REDIRECT } from "@/lib/auth-guards";
import {
  getCurrentGoalpost,
  getOrCreateActiveIntent,
  nextWizardRoute,
  daysSince,
  REFRESHER_OFFER_AFTER_DAYS,
  prisma,
} from "@/lib/journey/state";
import { StepType } from "@prisma/client";
import WarmUpRecap from "@/components/journey/WarmUpRecap";

// L0 §9.5 multi-session continuity — the warm-up recap screen for a resumed
// (paused) journey. Reached via nextWizardRoute (home) or the goalpost page
// redirect for any journey the lazy §6 state machine moved to `paused`.
//
// Status mutations on resume are implemented as INLINE "use server" actions in
// this file (not in app/(app)/journey/_actions.ts, which is owned by the PM) so
// this feature owns its own writes end-to-end. Both actions flip the journey
// back to `in_progress`; the opt-in refresher additionally re-opens the
// information phase by clearing the current goalpost's information step
// completedAt, so the read surface shows again.

// Resolve the active intent id and its current goalpost, enforcing the journey
// is genuinely resumable. Shared by the page and both server actions so the
// writes target exactly what the learner saw.
async function loadResumeContext(intentId?: string | null) {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/signin");
  if (isAnonymousSession(session)) redirect(GATE_REDIRECT);
  // Addressable resume: honor the `?j=<id>` param (passed by the page) / the
  // hidden form field (on the action submit) so the warm-up recap and its
  // continue/refresher writes target the journey the learner actually clicked,
  // not whichever was touched most recently. getOrCreateActiveIntent enforces
  // ownership (userId match) on the explicit id and falls back safely.
  const intent = await getOrCreateActiveIntent(session.user.id, intentId);
  if (!intent) redirect("/journey/intent");
  return { intent };
}

async function continueAction(formData: FormData): Promise<void> {
  "use server";
  const intentId = (formData.get("j") as string | null) ?? undefined;
  const { intent } = await loadResumeContext(intentId);
  if (intent!.status === "paused") {
    await prisma.learningIntent.update({
      where: { id: intent!.id },
      data: { status: "in_progress" },
    });
  }
  redirect(`/journey/goalpost?j=${intent!.id}`);
}

async function refresherAction(formData: FormData): Promise<void> {
  "use server";
  const intentId = (formData.get("j") as string | null) ?? undefined;
  const { intent } = await loadResumeContext(intentId);
  if (intent!.status === "paused") {
    await prisma.learningIntent.update({
      where: { id: intent!.id },
      data: { status: "in_progress" },
    });
  }
  // Opt-in refresher (B.6): re-open the information phase for the current
  // goalpost by clearing its information step's completedAt. The goalpost page
  // serves the information sub-view whenever that timestamp is null.
  const goalpost = await getCurrentGoalpost(intent!.id);
  const infoStep = goalpost?.steps.find((s) => s.type === StepType.information);
  if (infoStep && infoStep.completedAt) {
    await prisma.step.update({
      where: { id: infoStep.id },
      data: { completedAt: null },
    });
  }
  redirect(`/journey/goalpost?j=${intent!.id}`);
}

export default async function ResumePage({
  searchParams,
}: {
  searchParams?: Promise<{ j?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const { intent } = await loadResumeContext(params.j);

  // Only a `paused` journey warrants the warm-up recap. Anything else (a fresh
  // in_progress journey that did not cross the 7d idle line, or a wizard stage)
  // routes to where it actually belongs.
  if (intent!.status !== "paused") {
    redirect(nextWizardRoute(intent) as never);
  }

  const goalpost = await getCurrentGoalpost(intent!.id);
  if (!goalpost) redirect("/journey/path");

  const [subject, lastEval] = await Promise.all([
    prisma.subject.findUnique({
      where: { intentId: intent!.id },
      select: { canonicalName: true },
    }),
    prisma.checkpointEvaluation.findFirst({
      where: { goalpostId: goalpost!.id },
      orderBy: { createdAt: "desc" },
      select: { rationale: true },
    }),
  ]);

  // `updatedAt` is the best available last-activity signal without a schema
  // change (it reflects the last intent-level transition). It still reads as
  // `paused` here because continueAction/refresherAction have not run yet.
  const idleDays = daysSince(intent!.updatedAt);
  const offerRefresher = idleDays > REFRESHER_OFFER_AFTER_DAYS;

  return (
    <WarmUpRecap
      continueAction={continueAction}
      refresherAction={refresherAction}
      intentId={intent!.id}
      subjectName={subject?.canonicalName ?? null}
      order={goalpost!.order}
      title={goalpost!.title}
      objective={goalpost!.objective}
      lastRationale={lastEval?.rationale ?? null}
      idleDays={idleDays}
      offerRefresher={offerRefresher}
    />
  );
}
