"use client";

import { useFormStatus } from "react-dom";
import { useEffect, useState } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Fade from "@mui/material/Fade";
import SubmitButton from "@/components/journey/SubmitButton";

// Warm, honest narration for the (slow, 5-15s) evaluator. No fake progress
// bar -- we do not know how far along the model is, so we rotate descriptive
// copy instead of pretending to measure progress (B.6 Q5).
const WAIT_STEPS = [
  "Reading your answer closely…",
  "Looking for the reasoning behind it…",
  "Scoring it against the goalpost…",
  "Working out the best next step for you…",
];

function NarratedWait({ artifact }: { artifact: string }) {
  const { pending } = useFormStatus();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!pending) {
      setStep(0);
      return;
    }
    const id = setInterval(() => {
      setStep((s) => Math.min(s + 1, WAIT_STEPS.length - 1));
    }, 2500);
    return () => clearInterval(id);
  }, [pending]);

  if (!pending) return null;

  return (
    <Fade in={pending}>
      <Card variant="outlined" sx={{ bgcolor: "action.hover" }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={2} alignItems="center">
              <CircularProgress size={22} thickness={5} />
              <Typography variant="h6" component="p" aria-live="polite">
                {WAIT_STEPS[step]}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              This takes a few seconds — your work is safe and being read in full.
            </Typography>
            {artifact.trim() && (
              <Box
                sx={{
                  borderLeft: 3,
                  borderColor: "divider",
                  pl: 2,
                  maxHeight: 160,
                  overflow: "auto",
                }}
              >
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ whiteSpace: "pre-wrap" }}
                >
                  {artifact}
                </Typography>
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Fade>
  );
}

type Props = {
  stepId: string;
  action: (formData: FormData) => void | Promise<void>;
  // Rendered markdown of the prompt (server-rendered, passed as children).
  prompt: React.ReactNode;
};

/**
 * Client wrapper around the experience submit. While the slow live evaluator
 * runs, it replaces the editor with a narrated wait that echoes the learner's
 * own submission (B.6 Q5) and disables the submit button (no-feedback bug).
 */
export default function ExperienceForm({ stepId, action, prompt }: Props) {
  const [artifact, setArtifact] = useState("");

  return (
    <form action={action}>
      <input type="hidden" name="stepId" value={stepId} />
      <ExperienceBody
        prompt={prompt}
        artifact={artifact}
        onArtifactChange={setArtifact}
      />
    </form>
  );
}

// Split out so the body can read useFormStatus() (only valid inside <form>).
function ExperienceBody({
  prompt,
  artifact,
  onArtifactChange,
}: {
  prompt: React.ReactNode;
  artifact: string;
  onArtifactChange: (v: string) => void;
}) {
  const { pending } = useFormStatus();

  return (
    <Stack spacing={3}>
      <Typography variant="overline" color="text.secondary">
        Experience
      </Typography>
      {prompt}

      {pending ? (
        <NarratedWait artifact={artifact} />
      ) : (
        <TextField
          name="userArtifact"
          multiline
          minRows={8}
          fullWidth
          required
          value={artifact}
          onChange={(e) => onArtifactChange(e.target.value)}
          placeholder="Type your answer here. Show your work."
        />
      )}

      {/* Keep the value in the form even while the editor is swapped out for
          the narrated wait, so the submission always carries the artifact. */}
      {pending && <input type="hidden" name="userArtifact" value={artifact} />}

      <SubmitButton
        variant="contained"
        size="large"
        pendingLabel="Evaluating your answer…"
        sx={{ alignSelf: "flex-start" }}
      >
        Submit my answer
      </SubmitButton>
    </Stack>
  );
}
