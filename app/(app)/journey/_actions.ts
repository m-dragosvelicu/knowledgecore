"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentSession, isAnonymousSession } from "@/lib/auth";
import { requireOwnerId, requireRealUserId } from "@/lib/auth-guards";
import { assertGuestLlmBudget } from "@/lib/journey/guestRateLimit";
import { prisma, getOrCreateActiveIntent, getCurrentGoalpost } from "@/lib/journey/state";
import { getServices, getPathConfirmationInterviewer } from "@/lib/services";
import type {
  CanDoStatement,
  Competency,
  InterviewStep,
  InterviewTurn,
  ProbeAnswer,
  ProbeQuestion,
} from "@/lib/services/types";
import { Motivation, StepType, GoalpostStatus, JourneyStatus, Decision, Prisma } from "@prisma/client";
import { deriveDecision } from "@/lib/journey/decision";
import {
  applyPathAdjustment,
  applyPreAcceptancePathAdjustment,
  TERMINAL_GOALPOST_STATUSES,
} from "@/lib/journey/pathRevision";
import type { RubricScores } from "@/lib/services/types";
import type { PathConfirmationStep } from "@/lib/services";
import {
  applyCheckpointEvidence,
  recordRetry,
  recordVisualNotHelpful,
} from "@/lib/journey/profileStore";
import {
  ensureLessonContent,
  lessonContentText,
  readLessonGenerationState,
} from "@/lib/journey/lessonGeneration";
import type { LessonGenerationState } from "@/lib/journey/lessonGenerationState";

// Pre-journey owner context: a real OR guest (anonymous) owner id plus whether
// the owner is a guest, so the cost-bearing pre-journey stages can apply the D2
// guest LLM rate limit. Redirects to /signin only when there is no session.
async function ownerContext(): Promise<{ userId: string; isAnonymous: boolean }> {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    redirect("/signin");
  }
  return { userId: session.user.id, isAnonymous: isAnonymousSession(session) };
}

// Resolve the journey the action must operate on. When the caller threads the
// `?j=<id>` journey id (read from its form data / passed as an argument), load
// THAT journey (ownership enforced inside getOrCreateActiveIntent); otherwise
// fall back to the most-recently-updated non-terminal journey. Pinning the id
// end to end is what stops an in-flight wizard from silently drifting onto the
// most-recent journey when more than one is non-terminal.
async function requireActiveIntentId(
  userId: string,
  intentId?: string | null,
): Promise<string> {
  const intent = await getOrCreateActiveIntent(userId, intentId);
  if (!intent) {
    redirect("/journey/intent");
  }
  return intent.id;
}

// Normalize a FormData `j` field to a string id or undefined (empty strings,
// missing fields, and non-string values all collapse to undefined so the
// most-recent fallback in getOrCreateActiveIntent still applies).
function readJourneyId(formData: FormData): string | undefined {
  const j = formData.get("j");
  return typeof j === "string" && j.length > 0 ? j : undefined;
}

// Recency touch (resume-card fix): the home "pick up where you left off" card and
// getOrCreateActiveIntent both order non-terminal journeys by `updatedAt desc`.
// During the long-lived `in_progress` phase, per-goalpost actions write Step /
// Goalpost / CheckpointEvaluation rows but NOT the LearningIntent row, so
// `updatedAt` froze at path-acceptance and stopped tracking real activity — the
// resume target went stale when more than one journey reached in_progress. This
// bumps the intent's `@updatedAt` so it reflects the genuinely most-recently
// worked / left journey. Best-effort: a recency touch must never break the flow.
async function touchIntentRecency(intentId: string): Promise<void> {
  try {
    await prisma.learningIntent.update({
      where: { id: intentId },
      data: { updatedAt: new Date() },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[journey] failed to bump intent recency: ${(err as Error).message}`,
    );
  }
}

// L0.md §7: a repeat / adjust_plan is a signal that the initial assessment
// under-estimated effort (or missed a prerequisite). Record it on the
// KnowledgeAssessment for later calibration. Best-effort; never blocks the flow.
async function appendRecalibrationFlag(intentId: string, flag: string): Promise<void> {
  try {
    const assessment = await prisma.knowledgeAssessment.findUnique({
      where: { intentId },
    });
    if (!assessment) return;
    const existing = Array.isArray(assessment.recalibrationFlags)
      ? (assessment.recalibrationFlags as unknown as string[])
      : [];
    await prisma.knowledgeAssessment.update({
      where: { intentId },
      data: { recalibrationFlags: [...existing, flag] as unknown as object },
    });
  } catch {
    // calibration telemetry is non-critical; do not break the journey
  }
}

// ---------------------------------------------------------------------------
// Start a new learning intent (from landing page)
// ---------------------------------------------------------------------------

export async function startNewJourneyAction(): Promise<void> {
  const userId = await requireRealUserId();
  // Journeys coexist: starting a new one must NOT touch any other journey. The
  // new intent simply becomes the resume target because it has the newest
  // `updatedAt` (getOrCreateActiveIntent orders non-terminal journeys by it).
  // Carry the freshly created journey's id from step one so the wizard never
  // drifts onto a different (most-recent) journey once intake begins.
  const created = await prisma.learningIntent.create({
    data: {
      userId,
      rawText: "",
      status: "created",
    },
  });
  redirect(`/journey/intent?j=${created.id}`);
}

// Start a new journey carrying the intent typed in the home hero pill. Mirrors
// startNewJourneyAction (open a fresh journey alongside any others) but seeds the
// rawText and runs the same intent-parsing path as submitIntentAction so the
// learner lands straight in the flow instead of an empty intent box.
const heroIntentSchema = z.object({
  rawText: z.string().min(3, "Please describe what you want to learn."),
});

export async function startJourneyWithIntentAction(formData: FormData): Promise<void> {
  const { userId, isAnonymous } = await ownerContext();
  const parsed = heroIntentSchema.parse({ rawText: formData.get("rawText") });
  await assertGuestLlmBudget(isAnonymous);

  // Journeys coexist: starting a new one must NOT touch any other journey. The
  // new intent becomes the resume target via its newest `updatedAt`.

  const services = getServices();
  const subject = await services.intentParser.parse(parsed.rawText);

  const intent = await prisma.learningIntent.create({
    data: { userId, rawText: parsed.rawText, status: "goal_assessed" },
  });

  await prisma.subject.create({
    data: {
      intentId: intent.id,
      canonicalName: subject.canonicalName,
      scopeNote: subject.scopeNote,
    },
  });

  // Same ambiguity guard as submitIntentAction: never silently narrow.
  if (subject.ambiguous) {
    const params = new URLSearchParams({ confirm: "1", j: intent.id });
    if (subject.clarification) params.set("note", subject.clarification);
    redirect(`/journey/intent?${params.toString()}`);
  }

  redirect(`/journey/outcome?j=${intent.id}`);
}

// ---------------------------------------------------------------------------
// Stage 2 — submit intent text
// ---------------------------------------------------------------------------

const submitIntentSchema = z.object({
  rawText: z.string().min(3, "Please describe what you want to learn."),
});

export async function submitIntentAction(formData: FormData): Promise<void> {
  const { userId, isAnonymous } = await ownerContext();
  const j = readJourneyId(formData);
  const parsed = submitIntentSchema.parse({
    rawText: formData.get("rawText"),
  });
  await assertGuestLlmBudget(isAnonymous);

  const services = getServices();
  const subject = await services.intentParser.parse(parsed.rawText);

  // Find or create the active intent (pinned by the submitted `j` when present).
  const existing = await getOrCreateActiveIntent(userId, j);
  const intent = existing
    ? await prisma.learningIntent.update({
        where: { id: existing.id },
        data: { rawText: parsed.rawText, status: "goal_assessed" },
      })
    : await prisma.learningIntent.create({
        data: { userId, rawText: parsed.rawText, status: "goal_assessed" },
      });

  await prisma.subject.upsert({
    where: { intentId: intent.id },
    update: { canonicalName: subject.canonicalName, scopeNote: subject.scopeNote },
    create: {
      intentId: intent.id,
      canonicalName: subject.canonicalName,
      scopeNote: subject.scopeNote,
    },
  });

  // L0.md §3 Stage 2: do NOT silently narrow an ambiguous intent. When the
  // parser flagged the input as too vague / too broad / two-intents-in-one, send
  // the learner back to the intent page in a confirm/refine sub-view (the
  // clarification is transient, so it rides along on the query string). A clear,
  // singular intent flows straight through to the outcome interview as before.
  if (subject.ambiguous) {
    const params = new URLSearchParams({ confirm: "1", j: intent.id });
    if (subject.clarification) params.set("note", subject.clarification);
    redirect(`/journey/intent?${params.toString()}`);
  }

  redirect(`/journey/outcome?j=${intent.id}`);
}

// Confirm an ambiguous intent as-is and proceed to the outcome interview. The
// subject was already persisted by submitIntentAction; this just acknowledges
// the learner accepted the parser's best interpretation.
export async function confirmIntentAction(formData: FormData): Promise<void> {
  const userId = await requireOwnerId();
  const intentId = await requireActiveIntentId(userId, readJourneyId(formData));
  const subject = await prisma.subject.findUnique({ where: { intentId } });
  if (!subject) redirect(`/journey/intent?j=${intentId}`);
  redirect(`/journey/outcome?j=${intentId}`);
}

// ---------------------------------------------------------------------------
// Stages 3+4 — submit goal + outcome
// ---------------------------------------------------------------------------

// --- Multi-turn goal interview (L0.md §3 Stage 3+4, §5 Goal Interview Agent) ---
//
// The interview is a turn loop driven by the client, which holds the running
// transcript and re-sends it each turn (mirrors ProbeClient's stateless shape).
// `advanceInterviewAction` returns the next InterviewStep; `finalizeOutcomeAction`
// persists the synthesized outcome and moves the journey forward.

const interviewTurnSchema = z.object({
  role: z.enum(["assistant", "user"]),
  content: z.string(),
});

const advanceInterviewSchema = z.object({
  motivation: z.nativeEnum(Motivation),
  transcript: z.array(interviewTurnSchema),
});

// Best-effort numeric horizon parse for LearningGoal.timeHorizonDays (L0.md §4
// path-budget constraint). Recognizes simple "<n> day/week/month" phrasings; the
// raw user phrasing is always preserved separately in LearningGoal.timeHorizon.
function parseTimeHorizonDays(text: string): number | null {
  const m = text.toLowerCase().match(/(\d+)\s*(day|week|month|year)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2];
  const perUnit =
    unit === "day" ? 1 : unit === "week" ? 7 : unit === "month" ? 30 : 365;
  return n * perUnit;
}

// Most recent learner free-text answer in the transcript (seeds elaboration).
function latestUserText(transcript: InterviewTurn[]): string {
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i].role === "user") return transcript[i].content.trim();
  }
  return "";
}

/**
 * Advance the interview by one turn. Upserts LearningGoal (motivation + latest
 * learner free-text as elaboration + best-effort timeHorizon) as the interview
 * progresses, then returns the next InterviewStep for the client to render.
 */
export async function advanceInterviewAction(
  motivation: Motivation,
  transcript: InterviewTurn[],
  intentId?: string | null,
): Promise<InterviewStep> {
  const { userId, isAnonymous } = await ownerContext();
  intentId = await requireActiveIntentId(userId, intentId);
  const parsed = advanceInterviewSchema.parse({ motivation, transcript });
  await assertGuestLlmBudget(isAnonymous);

  const subject = await prisma.subject.findUnique({ where: { intentId } });
  if (!subject) redirect(`/journey/intent?j=${intentId}`);

  const services = getServices();
  const step = await services.goalInterviewer.interview({
    subject: { canonicalName: subject!.canonicalName, scopeNote: subject!.scopeNote },
    motivation: parsed.motivation,
    transcript: parsed.transcript,
  });

  // RESUME SUPPORT — persist the outcome sub-state as it is produced so a learner
  // who saves & leaves mid-outcome returns to their position (not the motivation
  // question). The transcript we store is the conversation INCLUDING the question
  // this turn just produced, so on re-hydration the outcome page can render the
  // dialogue exactly where it left off. On completion we also stash the
  // synthesized (not-yet-confirmed) outcome so resume lands on the confirm screen.
  const nextTranscript: InterviewTurn[] =
    step.kind === "complete"
      ? parsed.transcript
      : [...parsed.transcript, { role: "assistant", content: step.question }];
  const draftOutcome =
    step.kind === "complete"
      ? {
          canDoStatements: step.canDoStatements,
          successCriterion: step.successCriterion,
        }
      : null;

  // Persist what we know so far. elaboration is required (non-null) in the
  // schema, so default to a placeholder until the learner has answered.
  const elaboration = latestUserText(parsed.transcript) || "(in progress)";
  const horizonDays = parseTimeHorizonDays(elaboration);
  await prisma.learningGoal.upsert({
    where: { intentId },
    update: {
      motivation: parsed.motivation,
      elaboration,
      interviewTranscript: nextTranscript as unknown as object,
      draftOutcome: draftOutcome as unknown as object,
      ...(horizonDays !== null
        ? { timeHorizon: elaboration, timeHorizonDays: horizonDays }
        : {}),
    },
    create: {
      intentId,
      motivation: parsed.motivation,
      elaboration,
      interviewTranscript: nextTranscript as unknown as object,
      draftOutcome: draftOutcome as unknown as object,
      timeHorizon: horizonDays !== null ? elaboration : null,
      timeHorizonDays: horizonDays,
    },
  });

  // Recency touch: an interview turn is genuine activity on this journey, so it
  // should become the resume target (parity with the in_progress per-step touch).
  await touchIntentRecency(intentId);

  return step;
}

const finalizeOutcomeSchema = z.object({
  canDoStatements: z
    .array(
      z.object({
        text: z.string().min(1),
        bloomLevel: z.enum([
          "remember",
          "understand",
          "apply",
          "analyze",
          "evaluate",
          "create",
        ]),
      }),
    )
    .min(1),
  successCriterion: z.string().min(1),
});

/**
 * Finalize the interview: persist the confirmed can-do statements + success
 * criterion to ExpectedOutcome, mark the intent outcome_assessed, and proceed to
 * the probe.
 */
export async function finalizeOutcomeAction(
  canDoStatements: CanDoStatement[],
  successCriterion: string,
  intentId?: string | null,
): Promise<void> {
  const userId = await requireOwnerId();
  intentId = await requireActiveIntentId(userId, intentId);
  const parsed = finalizeOutcomeSchema.parse({ canDoStatements, successCriterion });

  await prisma.expectedOutcome.upsert({
    where: { intentId },
    update: {
      canDoStatements: parsed.canDoStatements,
      successCriterion: parsed.successCriterion,
    },
    create: {
      intentId,
      canDoStatements: parsed.canDoStatements,
      successCriterion: parsed.successCriterion,
    },
  });

  // The confirmed ExpectedOutcome is now authoritative; clear the resume draft so
  // a later return to the outcome stage never re-hydrates a stale pre-confirm draft.
  await prisma.learningGoal.updateMany({
    where: { intentId },
    data: { draftOutcome: Prisma.DbNull },
  });

  await prisma.learningIntent.update({
    where: { id: intentId },
    data: { status: "outcome_assessed" },
  });

  redirect(`/journey/probe?j=${intentId}`);
}

// ---------------------------------------------------------------------------
// Stage 5 — submit probe answers
// ---------------------------------------------------------------------------

const probeQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  kind: z.enum(["open", "multiple_choice"]),
  options: z.array(z.string()).optional(),
  competencyTag: z.string(),
});

const probeSubmissionSchema = z.object({
  questions: z.array(probeQuestionSchema),
  answers: z.array(
    z.object({
      questionId: z.string(),
      response: z.string(),
    }),
  ),
});

export async function submitProbeAction(
  questions: ProbeQuestion[],
  answers: ProbeAnswer[],
  intentId?: string | null,
): Promise<void> {
  const { userId, isAnonymous } = await ownerContext();
  intentId = await requireActiveIntentId(userId, intentId);
  const parsed = probeSubmissionSchema.parse({ questions, answers });
  await assertGuestLlmBudget(isAnonymous);

  const services = getServices();
  // Stateless scoring: pass the exact questions the learner answered. No
  // regeneration (which previously produced mismatched questions and 0/4 scores).
  const { competencies, transcript } = await services.knowledgeProbe.score(
    parsed.questions,
    parsed.answers,
  );

  await prisma.knowledgeAssessment.upsert({
    where: { intentId },
    update: {
      competencies: competencies as unknown as object,
      probeTranscript: transcript as unknown as object,
    },
    create: {
      intentId,
      competencies: competencies as unknown as object,
      probeTranscript: transcript as unknown as object,
    },
  });

  await prisma.learningIntent.update({
    where: { id: intentId },
    data: { status: "knowledge_assessed" },
  });

  redirect(`/journey/path?j=${intentId}`);
}

// ---------------------------------------------------------------------------
// Stage 6 — generate / accept path
// ---------------------------------------------------------------------------

export async function generatePathAction(intentId?: string | null): Promise<void> {
  const { userId, isAnonymous } = await ownerContext();
  intentId = await requireActiveIntentId(userId, intentId);

  const existing = await prisma.learningPath.findUnique({ where: { intentId } });
  if (existing) {
    return;
  }
  await assertGuestLlmBudget(isAnonymous);

  const subject = await prisma.subject.findUnique({ where: { intentId } });
  const goal = await prisma.learningGoal.findUnique({ where: { intentId } });
  const outcome = await prisma.expectedOutcome.findUnique({ where: { intentId } });
  const assessment = await prisma.knowledgeAssessment.findUnique({ where: { intentId } });
  if (!subject || !goal || !outcome || !assessment) {
    return;
  }

  const services = getServices();
  const goalposts = await services.pathOutliner.outline({
    subject: { canonicalName: subject.canonicalName, scopeNote: subject.scopeNote },
    motivation: goal.motivation,
    outcome: outcome.canDoStatements as unknown as CanDoStatement[],
    assessment: assessment.competencies as unknown as Competency[],
  });

  await prisma.learningPath.create({
    data: {
      intentId,
      goalposts: {
        create: goalposts.map((gp) => ({
          order: gp.order,
          title: gp.title,
          objective: gp.objective,
          estimatedMinutes: gp.estimatedMinutes,
          steps: {
            create: gp.steps.map((s) => ({
              order: s.order,
              type: s.type,
              payload: s.payload as object,
            })),
          },
        })),
      },
    },
  });

  await prisma.learningIntent.update({
    where: { id: intentId },
    data: { status: "path_outlined" },
  });
}

export async function acceptPathAction(j?: string | null): Promise<void> {
  // THE ACCOUNT GATE (landing-flow plan, section 3a — primary, server-side).
  // "Looks good, start" is the one transition from the public path overview into
  // goalpost 1. requireRealUserId rejects an anonymous guest and redirects them
  // to the create-account step (/journey/begin); only a real account proceeds
  // into goalpost 1. After the guest creates an account / signs in there, the
  // onLinkAccount claim re-owns the journey and /journey/begin re-invokes this
  // action — which now sees a real user and proceeds.
  // `j` pins the journey end to end so accept operates on (and lands the learner
  // in) the journey they actually confirmed, not whichever is most-recent.
  const userId = await requireRealUserId();
  const intentId = await requireActiveIntentId(userId, j);

  await prisma.learningPath.update({
    where: { intentId },
    data: { acceptedAt: new Date() },
  });
  await prisma.learningIntent.update({
    where: { id: intentId },
    data: { status: "in_progress" },
  });
  // Activate the first goalpost.
  const path = await prisma.learningPath.findUnique({
    where: { intentId },
    include: { goalposts: { orderBy: { order: "asc" } } },
  });
  const first = path?.goalposts[0];
  if (first && first.status === "pending") {
    await prisma.goalpost.update({
      where: { id: first.id },
      data: { status: "in_progress" },
    });
  }
  redirect(`/journey/goalpost?j=${intentId}`);
}

// ---------------------------------------------------------------------------
// L1 Slice 2 — Path Confirmation gate + clarifying dialogue
//
// After the structure-only path overview (Call A) and BEFORE goalpost 1, the
// learner always has a lightweight choice: "Looks good, start" (-> acceptPathAction
// above, which proceeds into goalpost 1 and triggers lazy Call B) or "Not quite
// right", which opens an OPT-IN clarifying dialogue.
//
// The dialogue REUSES the shared turn-taking primitive (the same InterviewTurn /
// step shape the Goal Interview uses): the client holds the running transcript
// and re-sends it each turn; `advancePathConfirmationAction` is stateless and
// returns the next step. On completion the synthesized concern is fed to the
// EXISTING Path Adjuster (`adjust_plan`) to revise the overview, which is then
// re-presented for confirmation. A soft cap on correction ROUNDS is enforced in
// the client (then it surfaces "you can adjust as you go").
// ---------------------------------------------------------------------------

const confirmationTranscriptSchema = z.array(interviewTurnSchema);

/**
 * Advance the clarifying dialogue by one turn. Stateless: the client passes the
 * whole transcript and we re-derive the next step. Returns the next
 * PathConfirmationStep (a question, or completion with the concern summary).
 */
export async function advancePathConfirmationAction(
  transcript: InterviewTurn[],
  intentId?: string | null,
): Promise<PathConfirmationStep> {
  const { userId, isAnonymous } = await ownerContext();
  intentId = await requireActiveIntentId(userId, intentId);
  const parsedTranscript = confirmationTranscriptSchema.parse(transcript);
  await assertGuestLlmBudget(isAnonymous);

  const [subject, outcome, path] = await Promise.all([
    prisma.subject.findUnique({ where: { intentId } }),
    prisma.expectedOutcome.findUnique({ where: { intentId } }),
    prisma.learningPath.findUnique({
      where: { intentId },
      include: {
        goalposts: {
          where: { status: { notIn: TERMINAL_GOALPOST_STATUSES } },
          orderBy: { order: "asc" },
        },
      },
    }),
  ]);
  if (!subject) redirect(`/journey/intent?j=${intentId}`);
  if (!path) redirect(`/journey/path?j=${intentId}`);

  const interviewer = getPathConfirmationInterviewer();
  return interviewer.clarify({
    subject: { canonicalName: subject!.canonicalName, scopeNote: subject!.scopeNote },
    outcome: (outcome?.canDoStatements as unknown as CanDoStatement[]) ?? [],
    overview: path!.goalposts.map((g) => ({
      order: g.order,
      title: g.title,
      objective: g.objective,
      estimatedMinutes: g.estimatedMinutes,
    })),
    transcript: parsedTranscript,
  });
}

const revisePathSchema = z.object({
  concern: z.string().min(1, "We need to know what is off to revise the plan."),
});

// Neutral rubric scores: the pre-acceptance revision is NOT triggered by a failed
// checkpoint, so there is no real evidence. The Path Adjuster reads scores as
// context only; the load-bearing signal is the concern (passed as the rationale).
const NEUTRAL_SCORES: RubricScores = {
  recall: 2,
  application: 2,
  conceptual: 2,
  transfer: 2,
  communication: 2,
  coverage: 2,
};

/**
 * Revise the draft path from the clarifying dialogue's concern. REUSES the
 * existing Path Adjuster (`adjust_plan`) to produce a minimal-edit PathAdjustment,
 * then applies it with the pre-acceptance applier (no goalpost is completed; the
 * whole draft is revised and renumbered). The learner is bounced back to the path
 * page to re-confirm the revised overview.
 */
export async function revisePathFromConfirmationAction(
  concern: string,
  intentId?: string | null,
): Promise<void> {
  const { userId, isAnonymous } = await ownerContext();
  intentId = await requireActiveIntentId(userId, intentId);
  const parsed = revisePathSchema.parse({ concern });
  await assertGuestLlmBudget(isAnonymous);

  const [subject, goal, outcome, assessment, path] = await Promise.all([
    prisma.subject.findUnique({ where: { intentId } }),
    prisma.learningGoal.findUnique({ where: { intentId } }),
    prisma.expectedOutcome.findUnique({ where: { intentId } }),
    prisma.knowledgeAssessment.findUnique({ where: { intentId } }),
    prisma.learningPath.findUnique({
      where: { intentId },
      include: {
        goalposts: {
          where: { status: { notIn: TERMINAL_GOALPOST_STATUSES } },
          orderBy: { order: "asc" },
        },
      },
    }),
  ]);

  // Guard: a path that is already accepted / in progress is past this gate.
  if (!subject || !goal || !outcome || !assessment || !path || path.acceptedAt) {
    redirect(`/journey/path?j=${intentId}`);
  }

  const goalposts = path!.goalposts;
  if (goalposts.length === 0) redirect(`/journey/path?j=${intentId}`);
  const anchor = goalposts[0];
  // The remaining overview the adjuster may keep/modify/remove is everything
  // AFTER the anchor goalpost (the anchor itself plays the "current" slot the
  // adjuster expects); the adjuster inserts new goalposts at anchor.order + 1.
  const remaining = goalposts.slice(1);

  const services = getServices();
  const adjustment = await services.pathAdjuster.adjust({
    subject: { canonicalName: subject!.canonicalName, scopeNote: subject!.scopeNote },
    motivation: goal!.motivation,
    outcome: outcome!.canDoStatements as unknown as CanDoStatement[],
    assessment: assessment!.competencies as unknown as Competency[],
    currentGoalpost: {
      order: anchor.order,
      title: anchor.title,
      objective: anchor.objective,
    },
    triggerScores: NEUTRAL_SCORES,
    // The learner's clarifying concern IS the rationale that drives the edit.
    triggerRationale: `Before starting, the learner said the proposed path is not quite right. ${parsed.concern}`,
    remainingGoalposts: remaining.map((g) => ({
      order: g.order,
      title: g.title,
      objective: g.objective,
      estimatedMinutes: g.estimatedMinutes,
    })),
  });

  await prisma.$transaction((tx) =>
    applyPreAcceptancePathAdjustment(tx, {
      pathId: path!.id,
      adjustment,
    }),
  );

  // Re-present the revised overview for another confirmation pass.
  redirect(`/journey/path?j=${intentId}`);
}

// ---------------------------------------------------------------------------
// Stage 7 — goalpost step transitions
// ---------------------------------------------------------------------------

const completeStepSchema = z.object({ stepId: z.string() });

export async function completeInformationStepAction(formData: FormData): Promise<void> {
  const userId = await requireRealUserId();
  const intentId = await requireActiveIntentId(userId, readJourneyId(formData));
  const { stepId } = completeStepSchema.parse({ stepId: formData.get("stepId") });

  await prisma.step.update({
    where: { id: stepId },
    data: { completedAt: new Date() },
  });
  await touchIntentRecency(intentId);
  redirect(`/journey/goalpost?j=${intentId}`);
}

const submitExperienceSchema = z.object({
  stepId: z.string(),
  userArtifact: z.string().min(1, "Please provide an answer."),
});

export async function submitExperienceStepAction(formData: FormData): Promise<void> {
  const userId = await requireRealUserId();
  const intentId = await requireActiveIntentId(userId, readJourneyId(formData));
  const parsed = submitExperienceSchema.parse({
    stepId: formData.get("stepId"),
    userArtifact: formData.get("userArtifact"),
  });

  const submittedAt = new Date();
  const step = await prisma.step.update({
    where: { id: parsed.stepId },
    data: {
      userArtifact: parsed.userArtifact,
      completedAt: submittedAt,
    },
    include: { goalpost: { include: { steps: { orderBy: { order: "asc" } } } } },
  });

  // Find sibling information step content + this experience prompt for the evaluator.
  const informationStep = step.goalpost.steps.find((s) => s.type === StepType.information);
  const informationContent = lessonContentText(informationStep?.payload ?? null);
  const experiencePrompt =
    (step.payload as { prompt?: string } | null)?.prompt ?? "";

  // Determine attempt count (existing evaluations + 1).
  const previousAttempts = await prisma.checkpointEvaluation.count({
    where: { goalpostId: step.goalpostId },
  });

  const attempt = previousAttempts + 1;
  const services = getServices();
  const evaluation = await services.checkpointEvaluator.evaluate({
    goalpostTitle: step.goalpost.title,
    goalpostObjective: step.goalpost.objective,
    informationContent,
    experiencePrompt,
    userArtifact: parsed.userArtifact,
    attempt,
  });

  // The evaluator's own `decision` is advisory. The authoritative branch is
  // derived deterministically from the rubric scores per L0.md §8, which also
  // enforces the §9.6 repeat cap independently of model behaviour.
  const decision = deriveDecision(evaluation.scores, attempt);

  await prisma.checkpointEvaluation.create({
    data: {
      goalpostId: step.goalpostId,
      attempt,
      scores: evaluation.scores as unknown as object,
      evidence: evaluation.evidence as unknown as object,
      decision,
      rationale: evaluation.rationale,
    },
  });

  // L1 SIGNAL CAPTURE: fold this checkpoint into the journey learner profile via
  // the pure BKT rule + an append-only snapshot. The goalpost id is the stable
  // concept key. Time-on-task ≈ (experience submitted) − (information completed),
  // a coarse but honest per-goalpost proxy. Best-effort: a profile write must
  // never break the learner's flow, so it is wrapped — the evaluation is already
  // persisted above regardless.
  try {
    const infoCompletedAt = informationStep?.completedAt ?? null;
    const timeOnTaskMs = infoCompletedAt
      ? Math.max(0, submittedAt.getTime() - infoCompletedAt.getTime())
      : 0;
    await applyCheckpointEvidence(intentId, userId, {
      conceptKey: step.goalpostId,
      decision,
      // The submission itself is attempt 1 (not a retry); a `repeat` decision
      // only becomes a retry when repeatGoalpostAction sets up the next attempt.
      isRepeat: false,
      timeOnTaskMs,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[learner-profile] failed to fold checkpoint evidence: ${
        (err as Error).message
      }`,
    );
  }

  await touchIntentRecency(intentId);
  redirect(`/journey/goalpost?j=${intentId}`);
}

const goalpostIdSchema = z.object({ goalpostId: z.string() });

// Shared advance core: complete the given goalpost, then either activate the
// next non-terminal goalpost or finish the journey. Returns the redirect target
// (the caller performs the redirect outside any try/catch).
async function doAdvance(
  intentId: string,
  userId: string,
  goalpostId: string,
): Promise<string> {
  await prisma.goalpost.update({
    where: { id: goalpostId },
    data: { status: GoalpostStatus.complete },
  });
  const completed = await prisma.goalpost.findUnique({
    where: { id: goalpostId },
    select: { pathId: true, order: true },
  });
  if (!completed) return `/journey/goalpost?j=${intentId}`;

  const next = await prisma.goalpost.findFirst({
    where: {
      pathId: completed.pathId,
      order: { gt: completed.order },
      status: { notIn: TERMINAL_GOALPOST_STATUSES },
    },
    orderBy: { order: "asc" },
  });
  if (next) {
    await prisma.goalpost.update({
      where: { id: next.id },
      data: { status: GoalpostStatus.in_progress },
    });
    // L1 LAZY GENERATION: PRE-GENERATE the next goalpost's lesson content now,
    // against the FRESHEST profile (the just-completed checkpoint already folded
    // its evidence), so the learner does not wait on entry. Best-effort and
    // idempotent — if it fails or is skipped, the goalpost page generates on
    // entry (with the "getting things ready" screen) as the fallback.
    try {
      await ensureLessonContent(intentId, userId, next.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[lesson-generation] pre-generation of next goalpost failed; will ` +
          `generate on entry. ${(err as Error).message}`,
      );
    }
    await touchIntentRecency(intentId);
    return `/journey/goalpost?j=${intentId}`;
  }

  await prisma.learningIntent.update({
    where: { id: intentId },
    data: { status: JourneyStatus.complete },
  });
  return `/journey/complete?j=${intentId}`;
}

// --- skip-with-confirm (L0.md §9.2; CEO override: allow skip with confirmation,
// "you'll be assessed on prerequisites later"). Marks the current goalpost
// `skipped` (NOT `complete`, unlike doAdvance) and then runs doAdvance's
// "activate next or finish" tail. getCurrentGoalpost already excludes skipped
// goalposts, so the next non-terminal goalpost becomes the active one.
export async function skipGoalpostAction(formData: FormData): Promise<void> {
  const userId = await requireRealUserId();
  const intentId = await requireActiveIntentId(userId, readJourneyId(formData));
  const { goalpostId } = goalpostIdSchema.parse({
    goalpostId: formData.get("goalpostId"),
  });

  const skipped = await prisma.goalpost.update({
    where: { id: goalpostId },
    data: { status: GoalpostStatus.skipped },
    select: { pathId: true, order: true },
  });

  const next = await prisma.goalpost.findFirst({
    where: {
      pathId: skipped.pathId,
      order: { gt: skipped.order },
      status: { notIn: TERMINAL_GOALPOST_STATUSES },
    },
    orderBy: { order: "asc" },
  });
  if (next) {
    await prisma.goalpost.update({
      where: { id: next.id },
      data: { status: GoalpostStatus.in_progress },
    });
    await touchIntentRecency(intentId);
    redirect(`/journey/goalpost?j=${intentId}`);
  }

  await prisma.learningIntent.update({
    where: { id: intentId },
    data: { status: JourneyStatus.complete },
  });
  redirect(`/journey/complete?j=${intentId}`);
}

export async function advanceGoalpostAction(formData: FormData): Promise<void> {
  const userId = await requireRealUserId();
  const intentId = await requireActiveIntentId(userId, readJourneyId(formData));
  const { goalpostId } = goalpostIdSchema.parse({
    goalpostId: formData.get("goalpostId"),
  });

  // Server-side guard (defense in depth): only advance if the latest evaluation
  // actually says advance, or the learner has explicitly overridden it.
  const latestEval = await prisma.checkpointEvaluation.findFirst({
    where: { goalpostId },
    orderBy: { createdAt: "desc" },
  });
  if (latestEval && latestEval.decision !== Decision.advance && !latestEval.userOverride) {
    redirect(`/journey/goalpost?j=${intentId}`);
  }

  const target = await doAdvance(intentId, userId, goalpostId);
  redirect(target);
}

// --- repeat: swap the experience for a Socratic retry on the weakest dimension

const DIMENSION_FOCUS: Record<keyof RubricScores, string> = {
  recall: "the key facts and terms involved",
  application: "how you would actually carry out the procedure, step by step",
  conceptual: "what is really going on underneath, explained in your own words",
  transfer: "how this idea would apply to a slightly different situation",
  communication: "your reasoning, laid out clearly enough that someone else could follow it",
  coverage: "how this connects back to the goalpost's objective",
};

// Lowest-scoring dimension excluding coverage (coverage drives adjust_plan, not repeat).
function weakestDimension(scores: RubricScores): keyof RubricScores {
  const dims: (keyof RubricScores)[] = [
    "recall",
    "application",
    "conceptual",
    "transfer",
    "communication",
  ];
  let weakest = dims[0];
  for (const d of dims) {
    if (scores[d] < scores[weakest]) weakest = d;
  }
  return weakest;
}

function buildSocraticRetryPrompt(
  objective: string,
  weakest: keyof RubricScores,
): string {
  const focus = DIMENSION_FOCUS[weakest];
  const obj = objective.replace(/\.$/, "");
  return [
    `Let's try this from a different angle. Instead of another exercise, talk me through your thinking.`,
    ``,
    `Focusing on ${focus}: in your own words, explain ${obj}.`,
    ``,
    `Go step by step and don't worry about being formal - I want to follow how you're reasoning about it.`,
  ].join("\n");
}

export async function repeatGoalpostAction(formData: FormData): Promise<void> {
  const userId = await requireRealUserId();
  const intentId = await requireActiveIntentId(userId, readJourneyId(formData));
  const { goalpostId } = goalpostIdSchema.parse({
    goalpostId: formData.get("goalpostId"),
  });

  const goalpost = await prisma.goalpost.findUnique({
    where: { id: goalpostId },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  if (!goalpost) redirect(`/journey/goalpost?j=${intentId}`);

  // Per L0.md §7: on repeat, swap the experience step for a Socratic one
  // focused on interpretation of the weakest rubric dimension, rather than
  // re-serving the same exercise. The information step stays completed.
  const latestEval = await prisma.checkpointEvaluation.findFirst({
    where: { goalpostId },
    orderBy: { createdAt: "desc" },
  });
  const experience = goalpost!.steps.find((s) => s.type !== StepType.information);
  if (experience) {
    const resetData: {
      userArtifact: null;
      completedAt: null;
      type?: StepType;
      payload?: object;
    } = { userArtifact: null, completedAt: null };

    if (latestEval) {
      const scores = latestEval.scores as unknown as RubricScores;
      const weak = weakestDimension(scores);
      resetData.type = StepType.experience_socratic;
      resetData.payload = {
        prompt: buildSocraticRetryPrompt(goalpost!.objective, weak),
        rubricFocus: [weak],
      };
    }

    await prisma.step.update({
      where: { id: experience.id },
      data: resetData,
    });
  }

  await appendRecalibrationFlag(
    intentId,
    `Goalpost "${goalpost!.title}" repeated - initial assessment may have under-estimated effort here.`,
  );

  // L1 SIGNAL CAPTURE: a repeat is a retry/struggle signal. Increment the
  // profile's totalRetries + write a `retry` snapshot. Best-effort.
  try {
    await recordRetry(intentId, userId, goalpostId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[learner-profile] failed to record retry signal: ${(err as Error).message}`,
    );
  }

  await touchIntentRecency(intentId);
  redirect(`/journey/goalpost?j=${intentId}`);
}

// --- adjust_plan: minimal-edit revision of the remaining path (live PathAdjuster)

export async function adjustPlanAction(formData: FormData): Promise<void> {
  const userId = await requireRealUserId();
  const intentId = await requireActiveIntentId(userId, readJourneyId(formData));
  const { goalpostId } = goalpostIdSchema.parse({
    goalpostId: formData.get("goalpostId"),
  });

  const goalpost = await prisma.goalpost.findUnique({ where: { id: goalpostId } });
  if (!goalpost) redirect(`/journey/goalpost?j=${intentId}`);
  const pathId = goalpost!.pathId;
  const currentOrder = goalpost!.order;

  const [latestEval, subject, goal, outcome, assessment, remaining] =
    await Promise.all([
      prisma.checkpointEvaluation.findFirst({
        where: { goalpostId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.subject.findUnique({ where: { intentId } }),
      prisma.learningGoal.findUnique({ where: { intentId } }),
      prisma.expectedOutcome.findUnique({ where: { intentId } }),
      prisma.knowledgeAssessment.findUnique({ where: { intentId } }),
      prisma.goalpost.findMany({
        where: {
          pathId,
          order: { gt: currentOrder },
          status: { notIn: TERMINAL_GOALPOST_STATUSES },
        },
        orderBy: { order: "asc" },
      }),
    ]);

  // Without full context (or an evaluation) we cannot adjust honestly — fall
  // back to completing the journey rather than fabricating a revision.
  if (!latestEval || !subject || !goal || !outcome || !assessment) {
    await prisma.learningIntent.update({
      where: { id: intentId },
      data: { status: JourneyStatus.complete },
    });
    redirect(`/journey/complete?j=${intentId}`);
  }

  const services = getServices();
  const adjustment = await services.pathAdjuster.adjust({
    subject: { canonicalName: subject!.canonicalName, scopeNote: subject!.scopeNote },
    motivation: goal!.motivation,
    outcome: outcome!.canDoStatements as unknown as CanDoStatement[],
    assessment: assessment!.competencies as unknown as Competency[],
    currentGoalpost: {
      order: currentOrder,
      title: goalpost!.title,
      objective: goalpost!.objective,
    },
    triggerScores: latestEval!.scores as unknown as RubricScores,
    triggerRationale: latestEval!.rationale,
    remainingGoalposts: remaining.map((g) => ({
      order: g.order,
      title: g.title,
      objective: g.objective,
      estimatedMinutes: g.estimatedMinutes,
    })),
  });

  await prisma.$transaction((tx) =>
    applyPathAdjustment(tx, {
      pathId,
      currentGoalpostId: goalpostId,
      currentOrder,
      adjustment,
      triggerEvalId: latestEval!.id,
    }),
  );

  await appendRecalibrationFlag(
    intentId,
    `Plan revised at goalpost "${goalpost!.title}" - a coverage or prerequisite gap was surfaced that the assessment missed.`,
  );

  await touchIntentRecency(intentId);

  // L0.md §7 Q7: show a must-acknowledge "we've adjusted your path" notice
  // before dropping the learner into the revised path.
  redirect(`/journey/adjusted?j=${intentId}`);
}

// --- user override of an evaluator decision (L0.md §7 / §4 userOverride) -----

const overrideSchema = z.object({
  goalpostId: z.string(),
  newDecision: z.nativeEnum(Decision),
  reason: z.string().optional(),
});

export async function overrideDecisionAction(formData: FormData): Promise<void> {
  const userId = await requireRealUserId();
  const intentId = await requireActiveIntentId(userId, readJourneyId(formData));
  const parsed = overrideSchema.parse({
    goalpostId: formData.get("goalpostId"),
    newDecision: formData.get("newDecision"),
    reason: formData.get("reason") || undefined,
  });

  const latestEval = await prisma.checkpointEvaluation.findFirst({
    where: { goalpostId: parsed.goalpostId },
    orderBy: { createdAt: "desc" },
  });
  if (!latestEval) redirect(`/journey/goalpost?j=${intentId}`);

  // Record the override as a calibration signal (L0.md §7: recorded, not hidden).
  await prisma.checkpointEvaluation.update({
    where: { id: latestEval!.id },
    data: {
      userOverride: {
        newDecision: parsed.newDecision,
        reason: parsed.reason ?? null,
      } as object,
    },
  });

  if (parsed.newDecision === Decision.advance) {
    const target = await doAdvance(intentId, userId, parsed.goalpostId);
    redirect(target);
  }
  await touchIntentRecency(intentId);
  redirect(`/journey/goalpost?j=${intentId}`);
}

// ---------------------------------------------------------------------------
// L1 LAZY GENERATION — prepare a goalpost's lesson content (Call B) on entry.
// Called by the "getting things ready" client screen the moment a goalpost with
// un-generated content is opened. Idempotent (ensureLessonContent no-ops if the
// content is already marked generated, e.g. it was pre-generated on advance).
// ---------------------------------------------------------------------------

export async function prepareGoalpostContentAction(
  goalpostId: string,
  intentId?: string | null,
): Promise<void> {
  const userId = await requireRealUserId();
  intentId = await requireActiveIntentId(userId, intentId);
  const parsed = goalpostIdSchema.parse({ goalpostId });
  await ensureLessonContent(intentId, userId, parsed.goalpostId);
  // Entering a goalpost is a recency signal too, so a learner who opens a
  // journey and leaves still has it surface as the resume target.
  await touchIntentRecency(intentId);
}

// ---------------------------------------------------------------------------
// L1 — Two-Phase Visual Lesson Pipeline (§8 progress channel).
//
// The GettingReady screen (Slice 4) POLLS this (~1s) while a goalpost generates.
// It returns the orchestrator's current generation-state record (stage / label /
// done / total / status). A server action cannot stream, so the orchestrator
// writes the record onto the information step and this action reads it back.
// `status: "ready"` -> the client refreshes into the lesson; `status: "failed"`
// -> the client shows a real error + Try again instead of looping forever.
// Ownership is enforced (only the journey's owner can poll its goalpost).
// ---------------------------------------------------------------------------

export async function readGoalpostGenerationStateAction(
  goalpostId: string,
  intentId?: string | null,
): Promise<LessonGenerationState | null> {
  const userId = await requireRealUserId();
  intentId = await requireActiveIntentId(userId, intentId);
  const parsed = goalpostIdSchema.parse({ goalpostId });
  // Ownership guard: the polled goalpost must belong to the resolved journey.
  const goalpost = await prisma.goalpost.findFirst({
    where: { id: parsed.goalpostId, path: { intentId } },
    select: { id: true },
  });
  if (!goalpost) return null;
  return readLessonGenerationState(parsed.goalpostId);
}

// ---------------------------------------------------------------------------
// L1 Slice 4 — "not helpful" feedback on a visual.
//
// The lightweight feedback control on a VisualMedia calls this. It increments the
// journey profile's `visualNotHelpfulCount` signal and writes an append-only
// snapshot. Best-effort: feedback must never break the learner's flow, so a
// failure is swallowed. It is a content+feedback modality signal, NOT a learner
// "type". (The parked image-search escape hatch that rides on this signal is
// explicitly deferred — out of L1.)
// ---------------------------------------------------------------------------

const visualFeedbackSchema = z.object({ visualId: z.string().min(1) });

export async function markVisualNotHelpfulAction(
  visualId: string,
  intentId?: string | null,
): Promise<void> {
  try {
    const userId = await requireRealUserId();
    intentId = await requireActiveIntentId(userId, intentId);
    const parsed = visualFeedbackSchema.parse({ visualId });
    await recordVisualNotHelpful(intentId, userId, parsed.visualId);
  } catch {
    // non-critical telemetry — never surface to the learner
  }
}

// ---------------------------------------------------------------------------
// Helper used by the goalpost page to re-fetch
// ---------------------------------------------------------------------------

export async function loadCurrentGoalpost(intentId: string) {
  return getCurrentGoalpost(intentId);
}
