"use client";

import { useState, useTransition } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import type { InterviewTurn } from "@/lib/services/types";
import {
  acceptPathAction,
  advancePathConfirmationAction,
  revisePathFromConfirmationAction,
} from "@/app/(app)/journey/_actions";
import MicButton from "@/components/journey/MicButton";
import SolidButton from "@/components/ui/SolidButton";
import WobbleButton from "@/components/ui/WobbleButton";
import { Eyebrow } from "@/components/ui";

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

// The shared paper-surface panel the dialogue draws its turns and the answer box
// on (mirrors the OutcomeClient / Goal Interview surface from Slice 3).
function Surface({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        bgcolor: "background.paper",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-sm)",
        p: "22px 26px",
      }}
    >
      {children}
    </Box>
  );
}

// A heading set in Fraunces at the UI display weight -- the voice that asks.
function AskHeadline({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="p"
      sx={{
        m: 0,
        fontFamily: "var(--font-display)",
        fontVariationSettings: "var(--soft-ui)",
        fontWeight: 500,
        fontSize: "clamp(20px, 2.6vw, 26px)",
        lineHeight: 1.18,
        letterSpacing: "-.01em",
        color: "var(--ink)",
      }}
    >
      {children}
    </Box>
  );
}

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
 *
 * Slice 4 restyle: the commit is a SOLID button, "Not quite right" is a WORKBENCH
 * (wobble) button, and the clarifying dialogue is the styled turn-taking cards.
 * Logic is unchanged.
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
      <Stack spacing={2.5}>
        <Divider />
        <Stack spacing={1}>
          <Eyebrow>Before you start</Eyebrow>
          <AskHeadline>Does this trail look right?</AskHeadline>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ maxWidth: "60ch", lineHeight: 1.6 }}
          >
            Take a look at the goalposts above and what you&rsquo;ll be able to do
            by the end. If it fits, let&rsquo;s begin. If something feels off, we
            can talk it through before you start.
          </Typography>
        </Stack>

        {revisionCount > 0 && (
          <Box
            sx={{
              bgcolor: "var(--surface-2)",
              border: "1px solid var(--line)",
              borderLeft: "3px solid var(--teal)",
              borderRadius: "var(--r-md)",
              p: "14px 18px",
            }}
          >
            <Typography variant="body2" color="text.secondary">
              We&rsquo;ve updated your trail. Take another look and start when
              it&rsquo;s right for you.
            </Typography>
          </Box>
        )}

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems={{ sm: "center" }}
          sx={{ pt: 0.5 }}
        >
          <SolidButton
            tone="ink"
            size="large"
            onClick={looksGood}
            disabled={isPending}
          >
            {isPending ? "Setting up your first goalpost…" : "Looks good, start"}
          </SolidButton>
          <WobbleButton onClick={openDialogue} disabled={isPending}>
            Not quite right
          </WobbleButton>
        </Stack>

        {atSoftCap && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ maxWidth: "60ch", lineHeight: 1.6 }}
          >
            You can keep refining, but you can also just start. The trail
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
        <Eyebrow>Let&rsquo;s get it right</Eyebrow>
        <AskHeadline>Tell us what feels off</AskHeadline>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: "60ch" }}>
          We&rsquo;ll adjust the plan before you start.
        </Typography>
      </Stack>

      {transcript.length > 0 && (
        <Stack spacing={1.5}>
          {transcript.map((t, i) => {
            const isAsk = t.role === "assistant";
            return (
              <Box
                key={i}
                sx={{
                  alignSelf: isAsk ? "flex-start" : "flex-end",
                  maxWidth: "86%",
                  bgcolor: isAsk ? "background.paper" : "var(--surface-2)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--r-md)",
                  boxShadow: isAsk ? "var(--shadow-sm)" : "none",
                  p: "14px 18px",
                }}
              >
                <Box className="kc-meta" sx={{ mb: "6px" }}>
                  {isAsk ? "Your guide" : "You"}
                </Box>
                <Box
                  sx={
                    isAsk
                      ? {
                          fontFamily: "var(--font-display)",
                          fontVariationSettings: "var(--soft-ui)",
                          fontWeight: 500,
                          fontSize: 17,
                          lineHeight: 1.35,
                          color: "var(--ink)",
                        }
                      : {
                          fontSize: 15.5,
                          lineHeight: 1.5,
                          color: "var(--ink)",
                        }
                  }
                >
                  {t.content}
                </Box>
              </Box>
            );
          })}
        </Stack>
      )}

      {question ? (
        <Surface>
          <Stack spacing={2}>
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
              <Stack direction="row" spacing={1.5} alignItems="center">
                <WobbleButton
                  onClick={() => setMode("gate")}
                  disabled={isPending}
                  bare
                >
                  Never mind, it&rsquo;s fine
                </WobbleButton>
                <MicButton
                  onTranscript={(t) =>
                    setDraft((prev) =>
                      prev.trim().length > 0
                        ? `${prev.replace(/\s+$/, "")} ${t}`
                        : t,
                    )
                  }
                  disabled={isPending}
                />
              </Stack>
              <SolidButton
                tone="ink"
                arrow={false}
                onClick={answer}
                disabled={draft.trim().length === 0 || isPending}
              >
                {isPending ? "Revising your trail…" : "Send"}
              </SolidButton>
            </Stack>
          </Stack>
        </Surface>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {isPending ? "Thinking about your trail…" : "Starting the conversation…"}
        </Typography>
      )}
    </Stack>
  );
}
