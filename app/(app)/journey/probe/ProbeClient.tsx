"use client";

import { useState, useTransition } from "react";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import RadioGroup from "@mui/material/RadioGroup";
import Radio from "@mui/material/Radio";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormControl from "@mui/material/FormControl";
import Box from "@mui/material/Box";
import type { ProbeAnswer, ProbeQuestion } from "@/lib/services/types";
import { submitProbeAction } from "@/app/(app)/journey/_actions";
import MicButton from "@/components/journey/MicButton";
import { SaveAndLeaveLink } from "@/components/journey/SaveAndLeave";
import { Eyebrow, SkipButton } from "@/components/ui";
import SolidButton from "@/components/ui/SolidButton";

type Props = {
  questions: ProbeQuestion[];
  // The resolved journey id (from ?j), threaded so scoring writes to and
  // advances the journey the learner actually opened, not the most-recent one.
  intentId: string;
  // Resume support: answers already persisted for this probe, keyed by
  // question id, plus the incremental per-answer save action.
  initialAnswers?: Record<string, string>;
  saveAnswerAction?: (
    intentId: string | null | undefined,
    questionIndex: number,
    answer: string,
  ) => Promise<void>;
};

// First index with no (or a blank) saved answer — a learner who dropped
// mid-probe resumes at the exact question they left, not the start.
// All-answered resolves to the last question, so a completed-but-unsubmitted
// resume lands on Submit rather than looping back to question 1.
function firstUnansweredIndex(
  questions: ProbeQuestion[],
  answers: Record<string, string>,
): number {
  for (let i = 0; i < questions.length; i++) {
    const value = answers[questions[i].id];
    if (!value || value.trim().length === 0) return i;
  }
  return Math.max(0, questions.length - 1);
}

export default function ProbeClient({
  questions,
  intentId,
  initialAnswers,
  saveAnswerAction,
}: Props) {
  const [index, setIndex] = useState(() =>
    firstUnansweredIndex(questions, initialAnswers ?? {}),
  );
  const [answers, setAnswers] = useState<Record<string, string>>(
    () => initialAnswers ?? {},
  );
  const [isPending, startTransition] = useTransition();

  if (questions.length === 0) {
    return (
      <Box sx={{ fontSize: 15.5, color: "var(--ink-2)" }}>
        No probe questions available. Please reload.
      </Box>
    );
  }

  const current = questions[index];
  const currentValue = answers[current.id] ?? "";
  const isLast = index === questions.length - 1;
  const canAdvance = currentValue.trim().length > 0;

  function setAnswer(value: string) {
    setAnswers((prev) => ({ ...prev, [current.id]: value }));
  }

  // Discrete per-question persistence (never per keystroke): fire-and-forget
  // so a slow save never blocks moving on. Best-effort — a dropped save just
  // means a resume re-asks that one question, matching the backend's design.
  function persistAnswer(questionIndex: number, value: string) {
    saveAnswerAction?.(intentId, questionIndex, value).catch(() => {});
  }

  function next() {
    if (!isLast) {
      persistAnswer(index, currentValue);
      setIndex((i) => i + 1);
    }
  }

  function submit() {
    persistAnswer(index, currentValue);
    const payload: ProbeAnswer[] = questions.map((q) => ({
      questionId: q.id,
      response: answers[q.id] ?? "",
    }));
    // Send the exact questions the learner saw so scoring is stateless and never
    // regenerates mismatched questions (the root cause of the all-0/4 bug).
    startTransition(async () => {
      await submitProbeAction(questions, payload, intentId);
    });
  }

  return (
    <Stack spacing={3}>
      {/* Quiet progress: an eyebrow "question N of M" with the competency as
          middot metadata, over the calm teal dot-row (no LinearProgress bar). */}
      <Box>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="baseline"
          sx={{ mb: "10px" }}
        >
          <Eyebrow>
            Question {index + 1} of {questions.length}
          </Eyebrow>
          <Box className="kc-meta">{current.competencyTag}</Box>
        </Stack>
        <Box className="kc-progress" aria-hidden="true">
          {questions.map((q, i) => (
            <span
              key={q.id}
              className={"kc-pdot" + (i <= index ? " on" : "")}
            />
          ))}
        </Box>
      </Box>

      <Box
        sx={{
          bgcolor: "background.paper",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-lg)",
          boxShadow: "var(--shadow-sm)",
          p: "24px 26px",
        }}
      >
        <Stack spacing={3}>
          <Box
            component="h2"
            sx={{
              m: 0,
              fontFamily: "var(--font-display)",
              fontVariationSettings: "var(--soft-ui)",
              fontWeight: 500,
              fontSize: "clamp(20px, 2.6vw, 26px)",
              lineHeight: 1.2,
              letterSpacing: "-.01em",
              color: "var(--ink)",
            }}
          >
            {current.prompt}
          </Box>

          {current.kind === "open" ? (
            <Stack spacing={1} alignItems="flex-start">
              <TextField
                multiline
                minRows={4}
                fullWidth
                placeholder="Type your answer here. It’s okay to say ‘I’m not sure’."
                value={currentValue}
                onChange={(e) => setAnswer(e.target.value)}
              />
              <MicButton
                onTranscript={(t) =>
                  setAnswer(
                    currentValue.trim().length > 0
                      ? `${currentValue.replace(/\s+$/, "")} ${t}`
                      : t,
                  )
                }
                disabled={isPending}
              />
            </Stack>
          ) : (
            <FormControl>
              <Eyebrow sx={{ mb: "8px" }}>Pick the closest answer</Eyebrow>
              <RadioGroup
                value={currentValue}
                onChange={(e) => setAnswer(e.target.value)}
              >
                {(current.options ?? []).map((opt) => (
                  <FormControlLabel
                    key={opt}
                    value={opt}
                    control={<Radio />}
                    label={opt}
                  />
                ))}
              </RadioGroup>
            </FormControl>
          )}

          <Stack
            direction="row"
            spacing={2}
            justifyContent="space-between"
            alignItems="center"
            sx={{ mt: "10px", pt: "18px", borderTop: "1px solid var(--line)" }}
          >
            <Stack direction="row" spacing={1.5} alignItems="center">
              <SaveAndLeaveLink />
              <SkipButton
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={index === 0 || isPending}
              >
                Back
              </SkipButton>
            </Stack>
            {isLast ? (
              <SolidButton
                tone="ink"
                arrow={false}
                onClick={submit}
                disabled={!canAdvance}
                pending={isPending}
                pendingLabel="Scoring…"
              >
                Submit
              </SolidButton>
            ) : (
              <Button
                variant="contained"
                color="kcInk"
                onClick={next}
                disabled={!canAdvance}
              >
                Continue
              </Button>
            )}
          </Stack>
        </Stack>
      </Box>
    </Stack>
  );
}
