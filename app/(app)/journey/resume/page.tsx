import { redirect } from "next/navigation";
import { getCurrentSession, isAnonymousSession } from "@/lib/auth";
import { GATE_REDIRECT } from "@/lib/auth-guards";
import { prisma } from "@/lib/db";
import { getCurrentGoalpost } from "@/lib/journey/intent/queries";
import {
  getOrCreateActiveIntent,
  daysSince,
  REFRESHER_OFFER_AFTER_DAYS,
} from "@/lib/journey/intent/resolution";
import { nextWizardRoute } from "@/lib/journey/intent/routing";
import { StepType } from "@prisma/client";
import WarmUpRecap from "@/app/(app)/journey/resume/_components/WarmUpRecap";

// L0 §9.5 multi-session continuity — warm-up recap for a resumed (paused)
// journey. Reached via nextWizardRoute (home) or the goalpost page redirect
// for any journey the lazy §6 state machine moved to `paused`.
//
// Status mutations are inline "use server" actions in this file (not
// app/(app)/journey/_actions.ts) so this feature owns its writes end-to-end.
// Both flip the journey back to `in_progress`; the opt-in refresher also
// re-opens the information phase by clearing the goalpost's information step
// completedAt.

// Resolve the active intent id and its current goalpost, enforcing the journey
// is genuinely resumable. Shared by the page and both server actions so the
// writes target exactly what the learner saw.
async function loadResumeContext(intentId?: string | null) {
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/signin");
  if (isAnonymousSession(session)) redirect(GATE_REDIRECT);
  // Addressable resume: honors `?j=<id>` / the hidden form field so writes
  // target the journey the learner actually clicked, not the most recent.
  // getOrCreateActiveIntent enforces ownership on the explicit id.
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
  if (!goalpost) redirect(`/journey/path?j=${intent!.id}`);

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
