"use client";

import { useState, useTransition } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import type { InterviewTurn } from "@/lib/services/types";
import {
  acceptPathAction,
  advancePathConfirmationAction,
  revisePathFromConfirmationAction,
} from "@/app/(app)/journey/_actions";

// Soft cap on CORRECTION ROUNDS (a round = one full clarifying dialogue that
// revises the path). After this many rounds the gate stays usable but gently
// surfaces "you can also adjust as you go", so a learner can neither loop forever
// nor feel trapped. The Path Adjuster runs mid-journey too, so this is honest.
const SOFT_CAP_ROUNDS = 3;

type Props = {
  /**
   * How many times this path has already been revised via confirmation (server
   * truth: LearningPath.revisionCount). Seeds the soft-cap counter so the gentle
   * "adjust as you go" message persists across the re-presented overview.
   */
  revisionCount: number;
};

type Mode = "gate" | "dialogue";

/**
 * L1 Slice 2 — the Path Confirmation gate + opt-in clarifying dialogue.
 *
 * Platform rule: there is ALWAYS a place to say "hold on" before committing to
 * the path. "Looks good, start" proceeds into goalpost 1 (triggering lazy Call
 * B). "Not quite right" opens the clarifying dialogue, which REUSES the shared
 * turn-taking primitive (the same transcript-driven loop the Goal Interview
 * uses): the client holds the running transcript and re-sends it each turn; the
 * server step is stateless. On completion the concern is handed to the EXISTING
 * Path Adjuster to revise the overview, then the page re-presents it here.
 */
export default function PathConfirmationGate({ revisionCount }: Props) {
  const [mode, setMode] = useState<Mode>("gate");
  const [transcript, setTranscript] = useState<InterviewTurn[]>([]);
  const [question, setQuestion] = useState<string>("");
  const [draft, setDraft] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  // revisionCount already reflects rounds applied on the server before this
  // render. atSoftCap gates the gentle nudge, never the ability to proceed.
  const atSoftCap = revisionCount >= SOFT_CAP_ROUNDS;

  function looksGood() {
    startTransition(async () => {
      await acceptPathAction();
    });
  }

  // One clarifying turn against the server, appending the optional new user turn
  // first. The server is stateless; we re-send the whole transcript (mirrors the
  // OutcomeClient / Goal Interview loop).
  function runTurn(nextTranscript: InterviewTurn[]) {
    startTransition(async () => {
      const step = await advancePathConfirmationAction(nextTranscript);
      if (step.kind === "complete") {
        // Hand the concern to the existing Path Adjuster; the action revises the
        // path and redirects back here to re-present the revised overview.
        await revisePathFromConfirmationAction(step.concern);
      } else {
        setQuestion(step.question);
        setTranscript([
          ...nextTranscript,
          { role: "assistant", content: step.question },
        ]);
      }
    });
  }

  function openDialogue() {
    setMode("dialogue");
    setTranscript([]);
    setQuestion("");
    setDraft("");
    runTurn([]);
  }

  function answer() {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    setDraft("");
    runTurn([...transcript, { role: "user", content: trimmed }]);
  }

  // ---- The always-present gate ----
  if (mode === "gate") {
    return (
      <Stack spacing={2}>
        <Divider />
        <Stack spacing={1}>
          <Typography variant="h6" component="h2">
            Does this path look right?
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Take a look at the goalposts above and what you&rsquo;ll be able to do
            by the end. If it fits, let&rsquo;s begin. If something feels off, we
            can talk it through before you start.
          </Typography>
        </Stack>

        {revisionCount > 0 && (
          <Alert severity="success" variant="outlined">
            We&rsquo;ve updated your path. Take another look and start when
            it&rsquo;s right for you.
          </Alert>
        )}

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems={{ sm: "center" }}
        >
          <Button
            variant="contained"
            size="large"
            onClick={looksGood}
            disabled={isPending}
          >
            {isPending ? "Setting up your first goalpost…" : "Looks good, start"}
          </Button>
          <Button
            variant="outlined"
            size="large"
            onClick={openDialogue}
            disabled={isPending}
          >
            Not quite right
          </Button>
        </Stack>

        {atSoftCap && (
          <Typography variant="body2" color="text.secondary">
            You can keep refining, but you can also just start &mdash; the path
            isn&rsquo;t locked. It adapts as you go, so you&rsquo;ll never be stuck
            with a step that isn&rsquo;t working.
          </Typography>
        )}
      </Stack>
    );
  }

  // ---- The opt-in clarifying dialogue (reused turn-taking primitive) ----
  return (
    <Stack spacing={3}>
      <Divider />
      <Stack spacing={1}>
        <Typography variant="h6" component="h2">
          Let&rsquo;s get your path right
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Tell us what feels off and we&rsquo;ll adjust the plan before you start.
        </Typography>
      </Stack>

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
                  bgcolor:
                    t.role === "assistant" ? "background.paper" : "action.hover",
                }}
              >
                <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                  >
                    {t.role === "assistant" ? "Guide" : "You"}
                  </Typography>
                  <Typography variant="body1">{t.content}</Typography>
                </CardContent>
              </Card>
            </Box>
          ))}
        </Stack>
      )}

      {question ? (
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
              <Stack
                direction="row"
                spacing={2}
                justifyContent="space-between"
                alignItems="center"
              >
                <Button
                  variant="text"
                  onClick={() => setMode("gate")}
                  disabled={isPending}
                >
                  Never mind, it&rsquo;s fine
                </Button>
                <Button
                  variant="contained"
                  onClick={answer}
                  disabled={draft.trim().length === 0 || isPending}
                >
                  {isPending ? "Revising your path…" : "Send"}
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {isPending ? "Thinking about your path…" : "Starting the conversation…"}
        </Typography>
      )}
    </Stack>
  );
}
