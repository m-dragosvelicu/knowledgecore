"use client";

import { useState, useTransition } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import RadioGroup from "@mui/material/RadioGroup";
import Radio from "@mui/material/Radio";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormControl from "@mui/material/FormControl";
import FormLabel from "@mui/material/FormLabel";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import { Motivation } from "@prisma/client";
import type { CanDoStatement, InterviewTurn } from "@/lib/services/types";
import {
  advanceInterviewAction,
  finalizeOutcomeAction,
} from "@/app/(app)/journey/_actions";

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
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={3}>
            <Typography variant="h5" component="h2">
              Tell us about your goal
            </Typography>
            <FormControl required>
              <FormLabel>Why do you want to learn this?</FormLabel>
              <RadioGroup
                row
                value={motivation}
                onChange={(e) => setMotivation(e.target.value as Motivation)}
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
              size="large"
              onClick={startInterview}
              disabled={motivation === "" || isPending}
              sx={{ alignSelf: "flex-start" }}
            >
              {isPending ? "Starting…" : "Start the conversation"}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  // ---- Phase 3: confirm synthesized outcome ----
  if (phase === "complete" && complete) {
    return (
      <Stack spacing={3}>
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h5" component="h2">
                Here is what success looks like for you
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {complete.successCriterion}
              </Typography>
              <Stack spacing={1.5} sx={{ mt: 1 }}>
                {complete.canDoStatements.map((s, i) => (
                  <Box
                    key={i}
                    sx={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 1.5,
                    }}
                  >
                    <Chip label={s.bloomLevel} size="small" variant="outlined" />
                    <Typography variant="body1">{s.text}</Typography>
                  </Box>
                ))}
              </Stack>
            </Stack>
          </CardContent>
        </Card>
        <Button
          variant="contained"
          size="large"
          onClick={finalize}
          disabled={isPending}
          sx={{ alignSelf: "flex-start" }}
        >
          {isPending ? "Designing your knowledge probe…" : "Continue to knowledge probe"}
        </Button>
      </Stack>
    );
  }

  // ---- Phase 2: the multi-turn conversation ----
  return (
    <Stack spacing={3}>
      {transcript.length > 0 && (
        <Stack spacing={2}>
          {transcript.map((t, i) => (
            <Box
              key={i}
              sx={{
                alignSelf: t.role === "assistant" ? "flex-start" : "flex-end",
                maxWidth: "85%",
              }}
            >
              <Card
                variant="outlined"
                sx={{
                  bgcolor: t.role === "assistant" ? "background.paper" : "action.hover",
                }}
              >
                <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                  >
                    {t.role === "assistant" ? "Interviewer" : "You"}
                  </Typography>
                  <Typography variant="body1">{t.content}</Typography>
                </CardContent>
              </Card>
            </Box>
          ))}
        </Stack>
      )}

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">{question}</Typography>
            <TextField
              multiline
              minRows={2}
              fullWidth
              placeholder="Type your answer…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={isPending}
            />
            <Button
              variant="contained"
              onClick={answer}
              disabled={draft.trim().length === 0 || isPending}
              sx={{ alignSelf: "flex-end" }}
            >
              {isPending ? "Thinking…" : "Send"}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
