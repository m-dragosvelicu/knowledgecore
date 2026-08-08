"use client";

import { useFormStatus } from "react-dom";
import { useEffect, useState } from "react";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Box from "@mui/material/Box";
import Fade from "@mui/material/Fade";
import SubmitButton from "@/components/journey/SubmitButton";
import MicButton from "@/components/journey/MicButton";
import { Eyebrow } from "@/components/ui";

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
      <Box
        sx={{
          bgcolor: "var(--surface-2)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-md)",
          p: "20px 22px",
        }}
      >
        <Stack spacing={1.5}>
          <Box
            sx={{
              fontFamily: "var(--font-display)",
              fontVariationSettings: "var(--soft-ui)",
              fontWeight: 500,
              fontSize: 19,
              lineHeight: 1.3,
              color: "var(--ink)",
            }}
            aria-live="polite"
          >
            {WAIT_STEPS[step]}
          </Box>
          <Box
            className="kc-meta"
            sx={{ textTransform: "none", letterSpacing: 0, fontSize: 13 }}
          >
            This takes a few seconds. Your work is safe and being read in full.
          </Box>
          {artifact.trim() && (
            <Box
              sx={{
                borderLeft: "3px solid var(--line)",
                pl: "14px",
                maxHeight: 160,
                overflow: "auto",
              }}
            >
              <Box
                sx={{
                  fontFamily: "var(--font-read)",
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: "var(--ink-2)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {artifact}
              </Box>
            </Box>
          )}
        </Stack>
      </Box>
    </Fade>
  );
}

type Props = {
  stepId: string;
  // The resolved journey id (from ?j), submitted as a hidden field so the
  // action evaluates and advances the journey the learner actually opened.
  intentId: string;
  action: (formData: FormData) => void | Promise<void>;
  // Rendered markdown of the prompt (server-rendered, passed as children).
  prompt: React.ReactNode;
};

/**
 * Experience surface — the "do" half of a goalpost.
 * Submit disabled while the live evaluator runs; editor swaps for a narrated
 * wait so the in-flight artifact stays visible (avoids the no-feedback bug).
 */
export default function ExperienceForm({ stepId, intentId, action, prompt }: Props) {
  const [artifact, setArtifact] = useState("");

  return (
    <form action={action}>
      <input type="hidden" name="j" value={intentId} />
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
      <Eyebrow>Build &middot; the experience half</Eyebrow>
      <Box
        sx={{
          fontFamily: "var(--font-read)",
          fontSize: "17px",
          lineHeight: 1.7,
          color: "var(--ink)",
          maxWidth: "62ch",
          "& p": { my: "0.9em" },
          "& strong": { fontWeight: 600 },
        }}
      >
        {prompt}
      </Box>

      {pending ? (
        <NarratedWait artifact={artifact} />
      ) : (
        <Stack spacing={1}>
          <TextField
            name="userArtifact"
            multiline
            minRows={4}
            fullWidth
            required
            value={artifact}
            onChange={(e) => onArtifactChange(e.target.value)}
            placeholder="Type your answer here. Show your work."
          />
          {/* Shared mic: dictation lands in the SAME editable field above, so the
              learner can fix any transcription error before this graded answer
              is submitted. */}
          <Box sx={{ alignSelf: "flex-start" }}>
            <MicButton
              onTranscript={(t) =>
                onArtifactChange(
                  artifact.trim().length > 0 ? `${artifact.replace(/\s+$/, "")} ${t}` : t,
                )
              }
              disabled={pending}
            />
          </Box>
        </Stack>
      )}

      {/* Keep the value in the form even while the editor is swapped out for
          the narrated wait, so the submission always carries the artifact. */}
      {pending && <input type="hidden" name="userArtifact" value={artifact} />}

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ sm: "center" }}
      >
        <SubmitButton
          variant="contained"
          color="kcInk"
          size="large"
          pendingLabel="Evaluating your answer…"
        >
          Lock it in
        </SubmitButton>
        {!pending && (
          <Box className="kc-meta" sx={{ textTransform: "none", letterSpacing: 0, fontSize: 13 }}>
            Saved to your trail as you go.
          </Box>
        )}
      </Stack>
    </Stack>
  );
}
