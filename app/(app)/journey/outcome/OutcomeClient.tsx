"use client";

import { useState, useTransition } from "react";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import RadioGroup from "@mui/material/RadioGroup";
import Radio from "@mui/material/Radio";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormControl from "@mui/material/FormControl";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import type { SxProps, Theme } from "@mui/material/styles";
import { Motivation } from "@prisma/client";
import type { CanDoStatement, InterviewTurn } from "@/lib/services/types";
import {
  advanceInterviewAction,
  finalizeOutcomeAction,
} from "@/app/(app)/journey/_actions";
import MicButton from "@/components/journey/MicButton";
import DialogueTurns from "@/components/journey/DialogueTurns";
import { Eyebrow } from "@/components/ui";

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
};

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

export default function OutcomeClient({ defaultMotivation }: Props) {
  const [phase, setPhase] = useState<Phase>("motivation");
  const [motivation, setMotivation] = useState<Motivation | "">(
    defaultMotivation ?? "",
  );
  const [transcript, setTranscript] = useState<InterviewTurn[]>([]);
  const [question, setQuestion] = useState<string>("");
  const [draft, setDraft] = useState<string>("");
  const [complete, setComplete] = useState<Complete | null>(null);
  const [isPending, startTransition] = useTransition();

  // Runs one interview turn against the server, appending the (optional) new
  // user turn first. The server holds no state; we re-send the whole transcript.
  function runTurn(nextTranscript: InterviewTurn[]) {
    if (motivation === "") return;
    const mot = motivation;
    startTransition(async () => {
      const step = await advanceInterviewAction(mot, nextTranscript);
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
      await finalizeOutcomeAction(complete.canDoStatements, complete.successCriterion);
    });
  }

  // ---- Phase 1: motivation selection (seeds LearningGoal.motivation) ----
  if (phase === "motivation") {
    return (
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
          <Button
            variant="contained"
            color="kcInk"
            size="large"
            onClick={startInterview}
            disabled={motivation === "" || isPending}
            sx={{ alignSelf: "flex-start" }}
          >
            {isPending ? "Starting…" : "Start the conversation"}
          </Button>
        </Stack>
      </Surface>
    );
  }

  // ---- Phase 3: confirm synthesized outcome (the can-do statements) ----
  if (phase === "complete" && complete) {
    return (
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

        <Button
          variant="contained"
          color="kcInk"
          size="large"
          onClick={finalize}
          disabled={isPending}
          sx={{ alignSelf: "flex-start" }}
        >
          {isPending ? "Designing your knowledge probe…" : "Continue to the knowledge probe"}
        </Button>
      </Stack>
    );
  }

  // ---- Phase 2: the multi-turn goal interview (turn-taking dialogue) ----
  // Earlier turns render above as a compact transcript. The ACTIVE question is
  // emitted exactly once -- as the input-card heading below -- so DialogueTurns
  // drops the trailing active question from the transcript (no double-render).
  return (
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
  );
}
