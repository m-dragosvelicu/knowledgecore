"use client";

import { useState, useTransition } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import LinearProgress from "@mui/material/LinearProgress";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import RadioGroup from "@mui/material/RadioGroup";
import Radio from "@mui/material/Radio";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormControl from "@mui/material/FormControl";
import FormLabel from "@mui/material/FormLabel";
import Box from "@mui/material/Box";
import type { ProbeAnswer, ProbeQuestion } from "@/lib/services/types";
import { submitProbeAction } from "@/app/(app)/journey/_actions";
import MicButton from "@/components/journey/MicButton";

type Props = {
  questions: ProbeQuestion[];
};

export default function ProbeClient({ questions }: Props) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  if (questions.length === 0) {
    return (
      <Typography variant="body1">
        No probe questions available. Please reload.
      </Typography>
    );
  }

  const current = questions[index];
  const currentValue = answers[current.id] ?? "";
  const isLast = index === questions.length - 1;
  const canAdvance = currentValue.trim().length > 0;

  function setAnswer(value: string) {
    setAnswers((prev) => ({ ...prev, [current.id]: value }));
  }

  function next() {
    if (!isLast) {
      setIndex((i) => i + 1);
    }
  }

  function submit() {
    const payload: ProbeAnswer[] = questions.map((q) => ({
      questionId: q.id,
      response: answers[q.id] ?? "",
    }));
    // Send the exact questions the learner saw so scoring is stateless and never
    // regenerates mismatched questions (the root cause of the all-0/4 bug).
    startTransition(async () => {
      await submitProbeAction(questions, payload);
    });
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Question {index + 1} of {questions.length}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {current.competencyTag}
          </Typography>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={((index + 1) / questions.length) * 100}
        />
      </Box>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={3}>
            <Typography variant="h6">{current.prompt}</Typography>

            {current.kind === "open" ? (
              <Stack spacing={0.5}>
                <TextField
                  multiline
                  minRows={4}
                  fullWidth
                  placeholder="Type your answer here. It is okay to say 'I am not sure'."
                  value={currentValue}
                  onChange={(e) => setAnswer(e.target.value)}
                />
                <Box sx={{ alignSelf: "flex-start" }}>
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
                </Box>
              </Stack>
            ) : (
              <FormControl>
                <FormLabel>Pick the best answer</FormLabel>
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

            <Stack direction="row" spacing={2} justifyContent="space-between">
              <Button
                variant="text"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={index === 0 || isPending}
              >
                Back
              </Button>
              {isLast ? (
                <Button
                  variant="contained"
                  onClick={submit}
                  disabled={!canAdvance || isPending}
                >
                  {isPending ? "Scoring…" : "Submit"}
                </Button>
              ) : (
                <Button
                  variant="contained"
                  onClick={next}
                  disabled={!canAdvance}
                >
                  Next
                </Button>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
