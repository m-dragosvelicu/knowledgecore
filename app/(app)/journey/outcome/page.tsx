import { redirect } from "next/navigation";
import Box from "@mui/material/Box";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOrCreateActiveIntent } from "@/lib/journey/intent/resolution";
import type { CanDoStatement, InterviewTurn } from "@/lib/services/types";
import OutcomeClient from "./OutcomeClient";

export default async function OutcomePage({
  searchParams,
}: {
  searchParams?: Promise<{ j?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const session = await getCurrentSession();
  if (!session?.user?.id) redirect("/"); // public pre-journey route; guests allowed
  const intent = await getOrCreateActiveIntent(session.user.id, params.j);
  if (!intent) redirect("/journey/intent");
  const subject = await prisma.subject.findUnique({ where: { intentId: intent.id } });
  if (!subject) redirect(`/journey/intent?j=${intent.id}`);
  const goal = await prisma.learningGoal.findUnique({ where: { intentId: intent.id } });

  // Resume support: re-hydrate the outcome sub-state persisted progressively by
  // advanceInterviewAction, so a learner who left mid-outcome returns to their
  // position, not the motivation question. Both are JSON columns on LearningGoal.
  const resumeTranscript =
    (goal?.interviewTranscript as unknown as InterviewTurn[] | null) ?? null;
  const resumeDraftOutcome =
    (goal?.draftOutcome as unknown as {
      canDoStatements: CanDoStatement[];
      successCriterion: string;
    } | null) ?? null;

  return (
    <Box sx={{ maxWidth: 760 }}>
      <OutcomeClient
        defaultMotivation={goal?.motivation ?? null}
        intentId={intent.id}
        initialSubject={{
          canonicalName: subject.canonicalName,
          scopeNote: subject.scopeNote,
        }}
        resumeTranscript={resumeTranscript}
        resumeDraftOutcome={resumeDraftOutcome}
      />
    </Box>
  );
}
