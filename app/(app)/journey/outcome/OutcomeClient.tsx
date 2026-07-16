"use client";

import { useState, useTransition } from "react";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import RadioGroup from "@mui/material/RadioGroup";
import Radio from "@mui/material/Radio";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormControl from "@mui/material/FormControl";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import type { SxProps, Theme } from "@mui/material/styles";
import { Motivation } from "@prisma/client";
import type { CanDoStatement, InterviewTurn } from "@/lib/services/types";
import type { OutcomeSubject } from "@/lib/services/outcomeRevision";
import {
  advanceInterviewAction,
  finalizeOutcomeAction,
  reviseOutcomeAction,
} from "@/app/(app)/journey/_actions";
import MicButton from "@/components/journey/MicButton";
import DialogueTurns from "@/components/journey/DialogueTurns";
import SaveAndLeaveRow from "@/components/journey/SaveAndLeave";
import { Eyebrow } from "@/components/ui";
import SolidButton from "@/components/ui/SolidButton";
import WobbleButton from "@/components/ui/WobbleButton";

// Next.js server actions signal a redirect() by throwing an error whose
// `digest` starts with "NEXT_REDIRECT" -- that throw must propagate, not be
// swallowed as a revision failure. reviseOutcomeAction only redirects on
// guard conditions (missing subject/draft) that should not occur once the
// learner is already looking at a rendered draft outcome.
function isNextRedirectError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

const MOTIVATIONS: Array<{ value: Motivation; label: string }> = [
  { value: "curiosity", label: "Curiosity" },
  { value: "fun", label: "Fun" },
  { value: "school", label: "School" },
  { value: "work", label: "Work" },
  { value: "other", label: "Other" },
];

type Phase = "motivation" | "interview" | "complete";

type Complete = {
  canDoStatements: CanDoStatement[];
  successCriterion: string;
};

type Props = {
  defaultMotivation: Motivation | null;
  // The resolved journey id (from ?j), threaded into every action so the
  // interview operates on and advances the journey the learner actually opened.
  intentId: string;
  // Server-fetched subject at render time. Lifted into client state (below)
  // rather than rendered server-side above this component, because the outcome
  // revision affordance can change the subject itself (canonicalName/scopeNote)
  // and this is the only place both the header and the revision trigger live.
  initialSubject: OutcomeSubject;
  // RESUME SUPPORT — the outcome sub-state persisted progressively to LearningGoal
  // (interviewTranscript / draftOutcome). When present, the flow re-hydrates to the
  // learner's position instead of restarting at the motivation question. The
  // transcript is the running conversation INCLUDING the trailing active question
  // (DialogueTurns drops it from the history; phase 2 shows it as the input heading).
  resumeTranscript: InterviewTurn[] | null;
  resumeDraftOutcome: Complete | null;
};

// The subject heading -- used to live above OutcomeClient server-side, now owned
// here since revision can rewrite the subject itself.
function SubjectHeader({ subject }: { subject: OutcomeSubject }) {
  return (
    <Box className="kc-fade" sx={{ mb: "32px", animationDelay: ".04s" }}>
      <Eyebrow sx={{ mb: "12px" }}>Your subject</Eyebrow>
      <Box
        component="h1"
        sx={{
          m: 0,
          fontFamily: "var(--font-display)",
          fontWeight: 400,
          fontSize: "clamp(30px, 4.4vw, 48px)",
          lineHeight: 1.06,
          letterSpacing: "-.02em",
          fontVariationSettings: '"SOFT" 20, "opsz" 144',
          color: "var(--ink)",
        }}
      >
        {subject.canonicalName}
      </Box>
      <Box
        component="p"
        sx={{ mt: "10px", fontSize: 15, lineHeight: 1.55, color: "var(--ink-2)" }}
      >
        {subject.scopeNote}
      </Box>
    </Box>
  );
}

// Last assistant turn = the active question to re-display when resuming mid-interview.
function lastAssistantQuestion(transcript: InterviewTurn[]): string {
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i].role === "assistant") return transcript[i].content;
  }
  return "";
}

// A heading set in Fraunces at the light/medium display weight — the voice that
// asks the questions through this flow. Used for the motivation prompt, the
// interview question, and the "what success looks like" header.
function AskHeadline({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="h2"
      sx={{
        m: 0,
        fontFamily: "var(--font-display)",
        fontVariationSettings: "var(--soft-ui)",
        fontWeight: 500,
        fontSize: "clamp(22px, 3vw, 30px)",
        lineHeight: 1.16,
        letterSpacing: "-.01em",
        color: "var(--ink)",
      }}
    >
      {children}
    </Box>
  );
}

// The shared paper-surface panel the flow draws its turns and steps on.
function Surface({
  children,
  recessed = false,
  sx,
}: {
  children: React.ReactNode;
  recessed?: boolean;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box
      sx={[
        {
          bgcolor: recessed ? "var(--surface-2)" : "background.paper",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-lg)",
          boxShadow: recessed ? "none" : "var(--shadow-sm)",
          p: "22px 26px",
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Box>
  );
}

export default function OutcomeClient({
  defaultMotivation,
  intentId,
  initialSubject,
  resumeTranscript,
  resumeDraftOutcome,
}: Props) {
  // RESUME SUPPORT — derive the starting phase/state from what was persisted:
  //   draft outcome present        -> "complete" (land on the confirm screen),
  //   a transcript with turns       -> "interview" (resume the conversation),
  //   otherwise                     -> "motivation" (fresh start).
  const hasTranscript = !!resumeTranscript && resumeTranscript.length > 0;
  const initialPhase: Phase = resumeDraftOutcome
    ? "complete"
    : hasTranscript
      ? "interview"
      : "motivation";

  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [subject, setSubject] = useState<OutcomeSubject>(initialSubject);
  const [motivation, setMotivation] = useState<Motivation | "">(
    defaultMotivation ?? "",
  );
  const [transcript, setTranscript] = useState<InterviewTurn[]>(
    resumeTranscript ?? [],
  );
  const [question, setQuestion] = useState<string>(
    hasTranscript ? lastAssistantQuestion(resumeTranscript!) : "",
  );
  const [draft, setDraft] = useState<string>("");
  const [complete, setComplete] = useState<Complete | null>(
    resumeDraftOutcome ?? null,
  );
  const [isPending, startTransition] = useTransition();

  // --- Outcome revision (founder ruling 2026-07-16) ---
  const [revising, setRevising] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [acknowledgment, setAcknowledgment] = useState<string | null>(null);
  const [reviseError, setReviseError] = useState<string | null>(null);
  const [isRevisePending, startReviseTransition] = useTransition();

  function openRevision() {
    setReviseError(null);
    setAcknowledgment(null);
    setRevising(true);
  }

  function cancelRevision() {
    setRevising(false);
    setReviseError(null);
  }

  // Single free-text objection -> a revised outcome (not a turn-taking dialogue;
  // see lib/services/outcomeRevision.ts). Repeatable: revising a revision reads
  // the latest persisted draft, so multiple rounds compound correctly.
  function submitRevision() {
    const trimmed = revisionFeedback.trim();
    if (trimmed.length === 0 || isRevisePending) return;
    setReviseError(null);
    startReviseTransition(async () => {
      try {
        const revised = await reviseOutcomeAction(intentId, trimmed);
        setSubject(revised.subject);
        setComplete({
          canDoStatements: revised.canDoStatements,
          successCriterion: revised.successCriterion,
        });
        setAcknowledgment(revised.acknowledgment);
        setRevisionFeedback("");
        setRevising(false);
      } catch (err) {
        if (isNextRedirectError(err)) throw err;
        setReviseError(
          "Something went wrong revising your outcome. Mind trying again?",
        );
      }
    });
  }

  // Runs one interview turn against the server, appending the (optional) new
  // user turn first. The server holds no state; we re-send the whole transcript.
  function runTurn(nextTranscript: InterviewTurn[]) {
    if (motivation === "") return;
    const mot = motivation;
    startTransition(async () => {
      const step = await advanceInterviewAction(mot, nextTranscript, intentId);
      if (step.kind === "complete") {
        setComplete({
          canDoStatements: step.canDoStatements,
          successCriterion: step.successCriterion,
        });
        setTranscript(nextTranscript);
        setPhase("complete");
      } else {
        setQuestion(step.question);
        setTranscript([
          ...nextTranscript,
          { role: "assistant", content: step.question },
        ]);
        setPhase("interview");
      }
    });
  }

  function startInterview() {
    if (motivation === "") return;
    runTurn([]);
  }

  function answer() {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    setDraft("");
    runTurn([...transcript, { role: "user", content: trimmed }]);
  }

  function finalize() {
    if (!complete) return;
    startTransition(async () => {
      await finalizeOutcomeAction(complete.canDoStatements, complete.successCriterion, intentId);
    });
  }

  // ---- Phase 1: motivation selection (seeds LearningGoal.motivation) ----
  if (phase === "motivation") {
    return (
      <>
        <SubjectHeader subject={subject} />
        <Box className="kc-fade" sx={{ animationDelay: ".12s" }}>
          <Surface>
            <Stack spacing={3}>
              <Box>
                <Eyebrow sx={{ mb: "10px" }}>Shaping your journey</Eyebrow>
                <AskHeadline>Why do you want to learn this?</AskHeadline>
              </Box>
              <FormControl required>
                <RadioGroup
                  row
                  value={motivation}
                  onChange={(e) => setMotivation(e.target.value as Motivation)}
                  sx={{ gap: "4px 18px" }}
                >
                  {MOTIVATIONS.map((m) => (
                    <FormControlLabel
                      key={m.value}
                      value={m.value}
                      control={<Radio />}
                      label={m.label}
                    />
                  ))}
                </RadioGroup>
              </FormControl>
              <SaveAndLeaveRow>
                <Button
                  variant="contained"
                  color="kcInk"
                  size="large"
                  onClick={startInterview}
                  disabled={motivation === "" || isPending}
                >
                  {isPending ? "Starting…" : "Start the conversation"}
                </Button>
              </SaveAndLeaveRow>
            </Stack>
          </Surface>
        </Box>
      </>
    );
  }

  // ---- Phase 3: confirm synthesized outcome (the can-do statements) ----
  if (phase === "complete" && complete) {
    return (
      <>
        <SubjectHeader subject={subject} />
        <Box className="kc-fade" sx={{ animationDelay: ".12s" }}>
          <Stack spacing={3}>
            <Box>
              <Eyebrow sx={{ mb: "12px" }}>By the end of this journey</Eyebrow>
              <AskHeadline>Here&rsquo;s what success looks like for you</AskHeadline>
              <Box
                component="p"
                sx={{ mt: "12px", fontSize: 15, lineHeight: 1.55, color: "var(--ink-2)" }}
              >
                {complete.successCriterion}
              </Box>
            </Box>

            {/* Can-do statements: a clean list of surface cards. The statement itself
                is set in Fraunces (the voice); the Bloom level is a quiet teal-soft
                chip and an eyebrow marks the list. */}
            <Box>
              <Eyebrow sx={{ mb: "12px" }}>You&rsquo;ll be able to</Eyebrow>
              <Stack spacing={1.5}>
                {complete.canDoStatements.map((s, i) => (
                  <Surface key={i} recessed sx={{ p: "16px 20px" }}>
                    <Stack
                      direction="row"
                      spacing={2}
                      alignItems="flex-start"
                    >
                      <Chip
                        label={s.bloomLevel}
                        size="small"
                        sx={{ textTransform: "capitalize", flexShrink: 0, mt: "2px" }}
                      />
                      <Box
                        sx={{
                          fontFamily: "var(--font-display)",
                          fontVariationSettings: "var(--soft-ui)",
                          fontWeight: 500,
                          fontSize: 18,
                          lineHeight: 1.35,
                          color: "var(--ink)",
                        }}
                      >
                        {s.text}
                      </Box>
                    </Stack>
                  </Surface>
                ))}
              </Stack>
            </Box>

            {/* Conversational acknowledgment of the last revision -- the same
                "your guide" bubble the transcript uses elsewhere in this flow. */}
            {acknowledgment && (
              <Box
                sx={{
                  alignSelf: "flex-start",
                  maxWidth: "86%",
                  bgcolor: "background.paper",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--r-md)",
                  boxShadow: "var(--shadow-sm)",
                  p: "14px 18px",
                }}
              >
                <Box className="kc-meta" sx={{ mb: "6px" }}>
                  Your guide
                </Box>
                <Box
                  sx={{
                    fontFamily: "var(--font-display)",
                    fontVariationSettings: "var(--soft-ui)",
                    fontWeight: 500,
                    fontSize: 17,
                    lineHeight: 1.35,
                    color: "var(--ink)",
                  }}
                >
                  {acknowledgment}
                </Box>
              </Box>
            )}

            {/* Revision affordance: a free-text objection, revised in place,
                repeatable (mirrors PathConfirmationGate's clarifying dialogue
                input card, but single-shot -- see lib/services/outcomeRevision.ts). */}
            {revising && (
              <Surface>
                <Stack spacing={2}>
                  <Eyebrow>Tell us what&rsquo;s off</Eyebrow>
                  <TextField
                    multiline
                    minRows={2}
                    fullWidth
                    autoFocus
                    placeholder="What would you change?"
                    value={revisionFeedback}
                    onChange={(e) => setRevisionFeedback(e.target.value)}
                    disabled={isRevisePending}
                  />
                  {reviseError && (
                    <Typography variant="body2" color="error">
                      {reviseError}
                    </Typography>
                  )}
                  <Stack
                    direction="row"
                    spacing={2}
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <WobbleButton
                        onClick={cancelRevision}
                        disabled={isRevisePending}
                        bare
                      >
                        Never mind
                      </WobbleButton>
                      <MicButton
                        onTranscript={(t) =>
                          setRevisionFeedback((prev) =>
                            prev.trim().length > 0
                              ? `${prev.replace(/\s+$/, "")} ${t}`
                              : t,
                          )
                        }
                        disabled={isRevisePending}
                      />
                    </Stack>
                    <SolidButton
                      tone="ink"
                      arrow={false}
                      onClick={submitRevision}
                      disabled={revisionFeedback.trim().length === 0 || isRevisePending}
                      pending={isRevisePending}
                      pendingLabel="Revising your outcome…"
                    >
                      Send
                    </SolidButton>
                  </Stack>
                </Stack>
              </Surface>
            )}

            <SaveAndLeaveRow>
              <Stack direction="row" spacing={2} alignItems="center">
                <WobbleButton
                  onClick={openRevision}
                  disabled={isPending || isRevisePending}
                >
                  Not quite right? Adjust it
                </WobbleButton>
                <SolidButton
                  tone="ink"
                  size="large"
                  onClick={finalize}
                  disabled={isPending || isRevisePending}
                  pending={isPending}
                  pendingLabel="Designing your knowledge probe…"
                >
                  Continue to the knowledge probe
                </SolidButton>
              </Stack>
            </SaveAndLeaveRow>
          </Stack>
        </Box>
      </>
    );
  }

  // ---- Phase 2: the multi-turn goal interview (turn-taking dialogue) ----
  // Earlier turns render above as a compact transcript. The ACTIVE question is
  // emitted exactly once -- as the input-card heading below -- so DialogueTurns
  // drops the trailing active question from the transcript (no double-render).
  return (
    <>
      <SubjectHeader subject={subject} />
      <Box className="kc-fade" sx={{ animationDelay: ".12s" }}>
        <Stack spacing={3}>
          <DialogueTurns transcript={transcript} />

          <Surface>
            <Stack spacing={2}>
              <Eyebrow>Your guide</Eyebrow>
              <AskHeadline>{question}</AskHeadline>
              <TextField
                multiline
                minRows={2}
                fullWidth
                placeholder="Type your answer…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={isPending}
              />
              <Stack
                direction="row"
                spacing={2}
                justifyContent="space-between"
                alignItems="center"
              >
                <MicButton
                  onTranscript={(t) =>
                    setDraft((prev) =>
                      prev.trim().length > 0 ? `${prev.replace(/\s+$/, "")} ${t}` : t,
                    )
                  }
                  disabled={isPending}
                />
                <Button
                  variant="contained"
                  color="kcInk"
                  onClick={answer}
                  disabled={draft.trim().length === 0 || isPending}
                >
                  {isPending ? "Thinking…" : "Continue"}
                </Button>
              </Stack>
            </Stack>
          </Surface>
        </Stack>
      </Box>
    </>
  );
}
