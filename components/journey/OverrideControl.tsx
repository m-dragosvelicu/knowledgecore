"use client";

import { useState } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";
import Collapse from "@mui/material/Collapse";
import Box from "@mui/material/Box";
import SubmitButton from "@/components/journey/SubmitButton";
import MicTextField from "@/components/journey/MicTextField";

type Props = {
  goalpostId: string;
  // The resolved journey id (from ?j), submitted as a hidden field so the
  // override mutates and advances the journey the learner actually opened.
  intentId: string;
  action: (formData: FormData) => void | Promise<void>;
};

/**
 * Low-key contestability control (L0.md §7 user override). The learner can say
 * the evaluation does not seem right, give a reason, and force an advance. The
 * override is recorded server-side as a calibration signal, not hidden.
 */
export default function OverrideControl({ goalpostId, intentId, action }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Box>
      {!open && (
        <Link
          component="button"
          type="button"
          variant="body2"
          color="text.secondary"
          underline="hover"
          onClick={() => setOpen(true)}
        >
          This evaluation doesn&rsquo;t seem right
        </Link>
      )}
      <Collapse in={open}>
        <form action={action}>
          <input type="hidden" name="j" value={intentId} />
          <input type="hidden" name="goalpostId" value={goalpostId} />
          <input type="hidden" name="newDecision" value="advance" />
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Tell us what the evaluation missed. We record this to improve the
              system, and you can continue to the next goalpost.
            </Typography>
            <MicTextField
              name="reason"
              multiline
              minRows={3}
              fullWidth
              placeholder="e.g., I explained the key step but used different wording than expected."
            />
            <Stack direction="row" spacing={2}>
              <SubmitButton
                variant="outlined"
                size="medium"
                pendingLabel="Recording and advancing…"
              >
                Submit and continue anyway
              </SubmitButton>
              <Link
                component="button"
                type="button"
                variant="body2"
                color="text.secondary"
                underline="hover"
                onClick={() => setOpen(false)}
              >
                Never mind
              </Link>
            </Stack>
          </Stack>
        </form>
      </Collapse>
    </Box>
  );
}
